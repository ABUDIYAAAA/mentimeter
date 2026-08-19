import mongoose from "mongoose";
import {
  Session,
  Participant,
  Slide,
  Response,
} from "../src/core/database/models/index.js";
import { getIo } from "./server.js";

class Syncer {
  /**
   * High-Performance Analytics Compiler
   * Uses MongoDB aggregation pipelines ($group, $unwind, $limit) instead of loading all responses into Node memory.
   */
  async compileAnalytics(slideId, slideType) {
    const slide = await Slide.findById(slideId).lean();
    if (!slide) return null;

    const effectiveType = slide.type || slideType;
    const targetSlideId = new mongoose.Types.ObjectId(slideId.toString());

    if (
      effectiveType === "BAR_GRAPH" ||
      effectiveType === "QUIZ" ||
      effectiveType === "select" ||
      effectiveType === "multi_select"
    ) {
      const results = (slide.options || []).map((opt) => ({
        id: opt.id,
        label: opt.label,
        count: opt.voteCount || 0,
        isCorrect: Boolean(opt.isCorrect),
      }));

      const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

      return {
        slideId: slideId.toString(),
        type: effectiveType === "QUIZ" ? "QUIZ" : "BAR_GRAPH",
        results,
        totalVotes,
      };
    }

    if (effectiveType === "WORD_CLOUD" || effectiveType === "text" || effectiveType === "multi_text") {
      // MongoDB Aggregation Pipeline: processes word counts inside DB engine and returns top 100 words
      const wordAgg = await Response.aggregate([
        { $match: { slideId: targetSlideId } },
        { $unwind: "$answer.raw" },
        {
          $project: {
            cleanWord: { $trim: { input: { $toLower: "$answer.raw" } } },
            rawWord: "$answer.raw",
          },
        },
        { $match: { cleanWord: { $ne: "" } } },
        {
          $group: {
            _id: "$cleanWord",
            value: { $sum: 1 },
            text: { $first: "$rawWord" },
          },
        },
        { $sort: { value: -1 } },
        { $limit: 100 },
      ]);

      const totalResponses = wordAgg.reduce((sum, item) => sum + item.value, 0);

      const wordCloud = wordAgg.map((item) => ({
        text: item.text,
        value: item.value,
      }));

      const wordCloudOptions = wordAgg.map((item, index) => ({
        id: `word-${index}-${item.text}`,
        label: item.text,
        voteCount: item.value,
      }));

      await Slide.updateOne(
        { _id: slideId },
        {
          $set: {
            options: wordCloudOptions,
          },
        }
      );

      return {
        slideId,
        type: "WORD_CLOUD",
        wordCloud,
        options: wordCloudOptions,
        results: wordCloudOptions,
        totalResponses,
      };
    }

    if (effectiveType === "SCALES" || effectiveType === "rating") {
      const min = slide.responseSettings?.minRating !== undefined ? slide.responseSettings.minRating : 1;
      const max = slide.responseSettings?.maxRating !== undefined ? slide.responseSettings.maxRating : 5;

      const ratingAgg = await Response.aggregate([
        { $match: { slideId: targetSlideId } },
        {
          $group: {
            _id: "$answer.rating",
            count: { $sum: 1 },
            sum: { $sum: "$answer.rating" },
          },
        },
      ]);

      const statsMap = {};
      for (const item of ratingAgg) {
        if (item._id !== null && item._id !== undefined) {
          statsMap[item._id] = { count: item.count, sum: item.sum };
        }
      }

      const results = [];
      let totalResponses = 0;

      for (let i = min; i <= max; i++) {
        const stats = statsMap[i] || { count: 0, sum: 0 };
        totalResponses += stats.count;
        const mean = stats.count > 0 ? Number((stats.sum / stats.count).toFixed(2)) : 0;
        results.push({
          id: `rate-${i}`,
          label: String(i),
          mean,
          count: stats.count,
        });
      }

      return {
        slideId,
        type: "SCALES",
        results,
        totalResponses,
      };
    }

    return {
      slideId,
      type: effectiveType,
      data: null,
    };
  }

  async getLiveState(sessionId, participantId = null) {
    const session = await Session.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const io = getIo();
    let participantCount = 0;

    if (io) {
      const roomName = `session_${sessionId}`;
      const hostRoomName = `session_${sessionId}_host`;
      const room = io.sockets.adapter.rooms.get(roomName);
      const hostRoom = io.sockets.adapter.rooms.get(hostRoomName);
      const totalSockets = room ? room.size : 0;
      const hostSockets = hostRoom ? hostRoom.size : 0;
      participantCount = Math.max(0, totalSockets - hostSockets);
    } else {
      participantCount = await Participant.countDocuments({
        sessionId,
        status: "active",
      });
    }

    let currentSlide = null;

    // Only expose currentSlide if presentation is actively live
    if (session.status === "live" && session.currentSlideId) {
      currentSlide = await Slide.findById(session.currentSlideId).lean();
    }

    let submittedSlideIds = [];
    if (participantId) {
      const responses = await Response.find({ sessionId, participantId }).select("slideId").lean();
      const rawIds = Array.from(new Set(responses.map((r) => r.slideId.toString())));

      if (
        currentSlide &&
        currentSlide.type === "WORD_CLOUD" &&
        (currentSlide.responseSettings?.multipleSubmissions === true ||
          currentSlide.responseSettings?.maxEntriesPerParticipant === 0)
      ) {
        submittedSlideIds = rawIds.filter((id) => id !== currentSlide._id.toString());
      } else {
        submittedSlideIds = rawIds;
      }
    }

    let leaderboard = null;
    if (currentSlide && currentSlide.type === "LEADERBOARD") {
      leaderboard = await this.compileLeaderboard(sessionId);
    }

    return {
      session: {
        id: session._id,
        code: session.code,
        status: session.status,
        version: session.version,
        settings: session.settings,
        currentSlideId: session.currentSlideId,
        isVotingLocked: session.isVotingLocked,
        quizState: session.quizState || null,
      },
      participantCount,
      currentSlide,
      submittedSlideIds,
      leaderboard,
    };
  }

  async compileLeaderboard(sessionId) {
    const participants = await Participant.find({
      sessionId,
      status: { $ne: "banned" },
    })
      .sort({ score: -1, joinedAt: 1 })
      .limit(10)
      .select("_id nickname score")
      .lean();

    const topParticipants = participants.map((p, index) => ({
      participantId: p._id.toString(),
      nickname: p.nickname,
      score: p.score || 0,
      rank: index + 1,
    }));

    return {
      sessionId: sessionId.toString(),
      topParticipants,
    };
  }

  constructor() {
    this._broadcastStateTimers = new Map();
    this._analyticsTimers = new Map();
    this._leaderboardTimers = new Map();
    this._lastLeaderboardSnapshots = new Map();
  }

  async sendStateToSocket(socket, sessionId) {
    try {
      const participantId = socket.participant ? socket.participant._id : null;
      const state = await this.getLiveState(sessionId, participantId);
      socket.emit("session_state_sync", state);
    } catch (error) {
      console.error("[Syncer] Failed to send state to socket:", error.message);
    }
  }

  /**
   * Debounced broadcast of full state payload per sessionId (250ms window).
   * Prevents 750 rapid connections from triggering 280,000 JSON frames.
   */
  async broadcastState(sessionId, immediate = false) {
    if (!sessionId) return;
    const key = sessionId.toString();

    if (immediate) {
      if (this._broadcastStateTimers.has(key)) {
        clearTimeout(this._broadcastStateTimers.get(key));
        this._broadcastStateTimers.delete(key);
      }
      return this._doBroadcastState(sessionId);
    }

    if (this._broadcastStateTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this._broadcastStateTimers.delete(key);
      this._doBroadcastState(sessionId);
    }, 250);

    this._broadcastStateTimers.set(key, timer);
  }

  async _doBroadcastState(sessionId) {
    try {
      const io = getIo();
      const roomName = `session_${sessionId}`;

      const sockets = await io.in(roomName).fetchSockets();
      if (sockets.length === 0) return;

      const state = await this.getLiveState(sessionId);
      io.to(roomName).emit("session_state_sync", state);
    } catch (error) {
      console.error("[Syncer] Failed to broadcast state:", error.message);
    }
  }

  /**
   * Debounced analytics broadcast per slideId (300ms window).
   * Aggregates rapid vote bursts into a single DB compile query instead of 1,500 concurrent table scans.
   */
  async broadcastSlideAnalytics(sessionId, slideId, slideType, immediate = false) {
    if (!slideId) return;
    const key = slideId.toString();

    if (immediate) {
      if (this._analyticsTimers.has(key)) {
        clearTimeout(this._analyticsTimers.get(key));
        this._analyticsTimers.delete(key);
      }
      return this._doBroadcastSlideAnalytics(sessionId, slideId, slideType);
    }

    if (this._analyticsTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this._analyticsTimers.delete(key);
      this._doBroadcastSlideAnalytics(sessionId, slideId, slideType);
    }, 300);

    this._analyticsTimers.set(key, timer);
  }

  async _doBroadcastSlideAnalytics(sessionId, slideId, slideType) {
    try {
      const io = getIo();
      const hostRoomName = `session_${sessionId}_host`;
      const roomName = `session_${sessionId}`;

      const analytics = await this.compileAnalytics(slideId, slideType);
      if (!analytics) return;

      io.to(hostRoomName).emit("slide_analytics_update", analytics);
      io.to(roomName).emit("slide_analytics_update", analytics);
    } catch (error) {
      console.error("[Syncer] Failed to broadcast slide analytics:", error.message);
    }
  }

  /**
   * Debounced leaderboard broadcast per sessionId (500ms window).
   * Coalesces high-concurrency score updates and suppresses broadcasts if top 10 snapshot hasn't changed.
   */
  async broadcastLeaderboard(sessionId, immediate = false) {
    if (!sessionId) return;
    const key = sessionId.toString();

    if (immediate) {
      if (this._leaderboardTimers.has(key)) {
        clearTimeout(this._leaderboardTimers.get(key));
        this._leaderboardTimers.delete(key);
      }
      return this._doBroadcastLeaderboard(sessionId, true);
    }

    if (this._leaderboardTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this._leaderboardTimers.delete(key);
      this._doBroadcastLeaderboard(sessionId, false);
    }, 300);

    this._leaderboardTimers.set(key, timer);
  }

  async _doBroadcastLeaderboard(sessionId, force = false) {
    try {
      const io = getIo();
      const roomName = `session_${sessionId}`;
      const hostRoomName = `session_${sessionId}_host`;

      const leaderboard = await this.compileLeaderboard(sessionId);
      const snapshotHash = JSON.stringify(leaderboard.topParticipants);
      const previousHash = this._lastLeaderboardSnapshots.get(sessionId.toString());

      if (!force && previousHash === snapshotHash) {
        return;
      }

      this._lastLeaderboardSnapshots.set(sessionId.toString(), snapshotHash);

      io.to(roomName).to(hostRoomName).emit("leaderboard_update", leaderboard);
    } catch (error) {
      console.error("[Syncer] Failed to broadcast leaderboard:", error.message);
    }
  }
}

export const syncer = new Syncer();
