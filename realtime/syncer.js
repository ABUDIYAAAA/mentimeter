import {
  Session,
  Participant,
  Slide,
  Response,
} from "../src/core/database/models/index.js";
import { getIo } from "./server.js";

class Syncer {
  /**
   * Helper to compile frequencies for text, multi_text, select, multi_select, and rating slides.
   */
  async compileAnalytics(slideId, slideType) {
    const slide = await Slide.findById(slideId).lean();
    if (!slide) return null;

    const responses = await Response.find({ slideId }).lean();
    const effectiveType = slide.type || slideType;

    if (effectiveType === "BAR_GRAPH" || effectiveType === "select" || effectiveType === "multi_select") {
      const optionCounts = {};

      for (const option of (slide.options || [])) {
        optionCounts[option.id] = 0;
      }

      for (const response of responses) {
        const optionIds = response.answer?.optionIds || [];
        for (const optionId of optionIds) {
          if (optionCounts[optionId] !== undefined) {
            optionCounts[optionId]++;
          }
        }
      }

      const results = (slide.options || []).map((opt) => ({
        id: opt.id,
        label: opt.label,
        count: optionCounts[opt.id] || 0,
      }));

      await Slide.updateOne(
        { _id: slideId },
        {
          $set: {
            options: (slide.options || []).map((opt) => ({
              ...opt,
              voteCount: optionCounts[opt.id] || 0,
            })),
          },
        }
      );

      return {
        slideId,
        type: "BAR_GRAPH",
        results,
        totalVotes: responses.length,
      };
    }

    if (effectiveType === "WORD_CLOUD" || effectiveType === "text" || effectiveType === "multi_text") {
      const wordCounts = {};

      for (const response of responses) {
        const processWord = (word) => {
          const clean = word ? String(word).trim() : "";
          if (!clean) return;
          wordCounts[clean] = (wordCounts[clean] || 0) + 1;
        };

        if (Array.isArray(response.answer?.raw)) {
          for (const rawAnswer of response.answer.raw) {
            processWord(rawAnswer);
          }
        } else if (response.answer?.text) {
          processWord(response.answer.text);
        }
      }

      const wordCloud = Object.entries(wordCounts).map(([text, value]) => ({
        text,
        value,
      }));

      const wordCloudOptions = wordCloud.map((w, index) => ({
        id: `word-${index}-${w.text}`,
        label: w.text,
        voteCount: w.value,
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
        totalResponses: responses.length,
      };
    }

    if (effectiveType === "SCALES" || effectiveType === "rating") {
      const min = slide.responseSettings?.minRating !== undefined ? slide.responseSettings.minRating : 1;
      const max = slide.responseSettings?.maxRating !== undefined ? slide.responseSettings.maxRating : 5;

      const optionStats = {};
      for (const option of (slide.options || [])) {
        optionStats[option.id] = { id: option.id, label: option.label, sum: 0, count: 0 };
      }

      // Initialize all rating scores in range so single-metric scale results populate
      for (let i = min; i <= max; i++) {
        const key = `rate-${i}`;
        if (!optionStats[key]) {
          optionStats[key] = { id: key, label: String(i), sum: 0, count: 0 };
        }
      }

      for (const response of responses) {
        const raw = response.answer?.raw;
        const ratingVal = typeof response.answer?.rating === "number" ? response.answer.rating : (typeof raw === "number" ? raw : null);

        if (ratingVal !== null) {
          const key = `rate-${ratingVal}`;
          if (!optionStats[key]) {
            optionStats[key] = { id: key, label: String(ratingVal), sum: 0, count: 0 };
          }
          optionStats[key].sum += ratingVal;
          optionStats[key].count += 1;
        } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [optionId, val] of Object.entries(raw)) {
            if (typeof val === "number") {
              if (!optionStats[optionId]) {
                optionStats[optionId] = { id: optionId, label: optionId, sum: 0, count: 0 };
              }
              optionStats[optionId].sum += val;
              optionStats[optionId].count += 1;
            }
          }
        }
      }

      const results = Object.entries(optionStats).map(([id, stats]) => {
        const mean = stats.count > 0 ? Number((stats.sum / stats.count).toFixed(2)) : 0;
        return {
          id,
          label: stats.label,
          mean,
          count: stats.count,
        };
      });

      if (slide.options && slide.options.length > 0) {
        await Slide.updateOne(
          { _id: slideId },
          {
            $set: {
              options: (slide.options || []).map((opt) => ({
                ...opt,
                voteCount: optionStats[opt.id]?.count || 0,
              })),
            },
          }
        );
      }

      return {
        slideId,
        type: "SCALES",
        results,
        totalResponses: responses.length,
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

    return {
      session: {
        id: session._id,
        code: session.code,
        status: session.status,
        version: session.version,
        settings: session.settings,
        currentSlideId: session.currentSlideId,
        isVotingLocked: session.isVotingLocked,
      },
      participantCount,
      currentSlide,
      submittedSlideIds,
    };
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

  async broadcastState(sessionId) {
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
   * Computes analytics for a specific slide and broadcasts it ONLY to the host room.
   */
  async broadcastSlideAnalytics(sessionId, slideId, slideType) {
    try {
      const io = getIo();
      const hostRoomName = `session_${sessionId}_host`;
      
      // Check if there's an active host listening
      const sockets = await io.in(hostRoomName).fetchSockets();
      if (sockets.length === 0) return;

      const analytics = await this.compileAnalytics(slideId, slideType);
      
      // Emit targeted analytics ONLY to the host
      io.to(hostRoomName).emit("slide_analytics_update", analytics);
    } catch (error) {
      console.error("[Syncer] Failed to broadcast slide analytics:", error.message);
    }
  }
}

export const syncer = new Syncer();
