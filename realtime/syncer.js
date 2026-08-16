import {
  Session,
  Participant,
  Slide,
} from "../src/core/database/models/index.js";
import { getIo } from "./server.js";

class Syncer {
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
}

export const syncer = new Syncer();
