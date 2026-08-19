import { Participant, Session, Slide } from "../../src/core/database/models/index.js";
import { syncer } from "../syncer.js";

export const handleConnection = async (socket) => {
  let sessionId;

  try {
    if (socket.participant) {
      sessionId = socket.participant.sessionId;
      console.log(`[WS Participant Connected] Participant ${socket.participant._id} connected to session ${sessionId}`);

      await Participant.findByIdAndUpdate(socket.participant._id, {
        $set: {
          status: "active",
          socketId: socket.id,
          lastSeenAt: new Date(),
        },
      });
    } else if (socket.user || socket.data?.role === "host") {
      sessionId = socket.data?.sessionId || socket.handshake.query?.sessionId;

      if (socket.user?._id) {
        const userIdStr = socket.user._id.toString();
        socket.join(`user_${userIdStr}`);
      }

      if (sessionId) {
        console.log(`[WS Presenter Connected] Presenter connected to session ${sessionId}`);
      }
    }

    if (sessionId) {
      // Join the secure Socket.io room for this session
      const roomName = `session_${sessionId}`;
      socket.join(roomName);

      // If this is the presenter, join them to the exclusive host room for sensitive data
      if (socket.user || socket.data?.role === "host") {
        socket.join(`${roomName}_host`);
      }

      // Cache the sessionId on the socket object
      socket.sessionId = sessionId;

      // Immediately send full state payload ONLY to the connected socket
      await syncer.sendStateToSocket(socket, sessionId);

      // If host, send analytics for active slide
      if (socket.user) {
        const activeSession = await Session.findById(sessionId).select("currentSlideId").lean();
        if (activeSession && activeSession.currentSlideId) {
          const slide = await Slide.findById(activeSession.currentSlideId).select("type").lean();
          if (slide) {
            await syncer.broadcastSlideAnalytics(sessionId, activeSession.currentSlideId, slide.type, true);
          }
        }
      }

      // Broadcast state update to everyone else in room
      await syncer.broadcastState(sessionId);
    }
  } catch (error) {
    console.error("[WS] Connection Error:", error.message);
    socket.emit("error", { message: error.message });
    socket.disconnect();
  }
};

export const handleDisconnection = async (socket) => {
  try {
    if (!socket.sessionId) return;

    if (socket.participant) {
      await Participant.findByIdAndUpdate(socket.participant._id, {
        $set: {
          status: "disconnected",
          disconnectedAt: new Date(),
        },
      });
    }

    await syncer.broadcastState(socket.sessionId);
  } catch (error) {
    console.error("[WS] Disconnect Error:", error.message);
  }
};
