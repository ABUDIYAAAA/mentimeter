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
    const responses = await Response.find({ slideId }).lean();

    if (slideType === "text" || slideType === "multi_text") {
      const wordCounts = {};

      for (const response of responses) {
        const processWord = (word) => {
          const clean = word.trim();
          if (!clean) return;
          
          if (!wordCounts[clean]) {
            wordCounts[clean] = 0;
          }
          wordCounts[clean]++;
        };

        if (slideType === "text" && response.answer?.text) {
          processWord(response.answer.text);
        } else if (slideType === "multi_text" && Array.isArray(response.answer?.raw)) {
          for (const rawAnswer of response.answer.raw) {
            if (typeof rawAnswer === "string") {
              processWord(rawAnswer);
            }
          }
        }
      }

      const wordCloud = Object.entries(wordCounts).map(([text, value]) => ({
        text,
        value,
      }));

      return {
        slideId,
        type: slideType,
        wordCloud,
      };
    }

    if (slideType === "select" || slideType === "multi_select") {
      const slide = await Slide.findById(slideId).lean();
      if (!slide) return null;

      // Initialize counts to 0 for all valid options defined on the slide
      const optionCounts = {};
      const optionDetails = {};
      for (const option of slide.content.options) {
        optionCounts[option.id] = 0;
        optionDetails[option.id] = option.text;
      }

      // Tally the votes
      for (const response of responses) {
        if (Array.isArray(response.answer?.optionIds)) {
          for (const optionId of response.answer.optionIds) {
            if (optionCounts[optionId] !== undefined) {
              optionCounts[optionId]++;
            }
          }
        }
      }

      // Format as an array of results
      const results = Object.entries(optionCounts).map(([id, count]) => ({
        id,
        text: optionDetails[id],
        count,
      }));

      return {
        slideId,
        type: slideType,
        results,
      };
    }

    if (slideType === "rating") {
      const slide = await Slide.findById(slideId).lean();
      if (!slide) return null;

      // Initialize sums and counts for all options
      const optionStats = {};
      for (const option of slide.content.options) {
        optionStats[option.id] = { text: option.text, sum: 0, count: 0 };
      }

      for (const response of responses) {
        const ratings = response.answer?.raw; // object { optionId: number }
        if (ratings && typeof ratings === "object" && !Array.isArray(ratings)) {
          for (const [optionId, ratingVal] of Object.entries(ratings)) {
            if (optionStats[optionId] && typeof ratingVal === "number") {
              optionStats[optionId].sum += ratingVal;
              optionStats[optionId].count += 1;
            }
          }
        }
      }

      const results = Object.entries(optionStats).map(([id, stats]) => {
        const mean = stats.count > 0 ? (stats.sum / stats.count) : 0;
        return {
          id,
          text: stats.text,
          mean: Number(mean.toFixed(2)), // Keep it to 2 decimal places
          count: stats.count,
        };
      });

      return {
        slideId,
        type: slideType,
        results,
      };
    }

    // Extensible switcher for future slide types
    return {
      slideId,
      type: slideType,
      data: null,
    };
  }

  async getLiveState(sessionId) {
    const session = await Session.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const participantCount = await Participant.countDocuments({
      sessionId,
      status: "active",
    });

    let currentSlide = null;

    if (session.currentSlideId) {
      currentSlide = await Slide.findById(session.currentSlideId).lean();
    }

    return {
      session: {
        id: session._id,
        status: session.status,
        version: session.version,
        settings: session.settings,
        currentSlideId: session.currentSlideId,
        isVotingLocked: session.isVotingLocked,
      },
      participantCount,
      currentSlide,
    };
  }

  async sendStateToSocket(socket, sessionId) {
    try {
      const state = await this.getLiveState(sessionId);
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
