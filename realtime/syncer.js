import {
  Session,
  Participant,
  Slide,
  Response,
} from "../src/core/database/models/index.js";
import { getIo } from "./server.js";

class Syncer {
  /**
   * Helper to compile word/phrase frequencies for text and multi_text slides.
   * Compiles case-insensitively but preserves the casing of the first submitted instance.
   */
  async compileAnalytics(slideId, slideType) {
    const responses = await Response.find({ slideId }).lean();

    if (slideType === "text" || slideType === "multi_text") {
      const wordCounts = {};
      const originalCases = {};

      for (const response of responses) {
        const processWord = (word) => {
          const clean = word.trim();
          if (!clean) return;
          const lower = clean.toLowerCase();
          
          if (!wordCounts[lower]) {
            wordCounts[lower] = 0;
            originalCases[lower] = clean;
          }
          wordCounts[lower]++;
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

      const wordCloud = Object.entries(wordCounts).map(([lower, value]) => ({
        text: originalCases[lower],
        value,
      }));

      return {
        slideId,
        type: slideType,
        wordCloud,
      };
    }

    // Extensible switcher for future slide types (select, rating, etc.)
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
