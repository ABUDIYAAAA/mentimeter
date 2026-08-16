import { Participant, Session, Slide } from "../../src/core/database/models/index.js";
import { syncer } from "../syncer.js";

export const handleConnection = async (socket) => {
  let sessionId;

  try {
    if (socket.participant) {
      sessionId = socket.participant.sessionId;

      await Participant.findByIdAndUpdate(socket.participant._id, {
        $set: {
          status: "active",
          socketId: socket.id,
          lastSeenAt: new Date(),
        },
      });
    } else if (socket.user) {
      sessionId = socket.handshake.query.sessionId;
      if (!sessionId) {
        throw new Error("Missing sessionId in query for presenter connection");
      }

      const session = await Session.findOne({
        _id: sessionId,
        presenterId: socket.user._id,
      }).lean();
      if (!session) {
        throw new Error(
          "Unauthorized: You are not the presenter of this session",
        );
      }
    }

    // Join the secure Socket.io room for this session
    const roomName = `session_${sessionId}`;
    socket.join(roomName);

    // If this is the presenter, join them to the exclusive host room for sensitive data (like analytics)
    if (socket.user) {
      socket.join(`${roomName}_host`);
    }

    // Cache the sessionId on the socket object so the disconnect handler can easily reference it
    socket.sessionId = sessionId;

    console.log(`[WS] Socket ${socket.id} joined room ${roomName}`);

    // Step A: Immediately send the full state payload ONLY to the person who just connected so they can render
    await syncer.sendStateToSocket(socket, sessionId);

    // If it's the host, send them the analytics for the active slide immediately upon connection
    if (socket.user) {
      const activeSession = await Session.findById(sessionId).select("currentSlideId").lean();
      if (activeSession && activeSession.currentSlideId) {
        const slide = await Slide.findById(activeSession.currentSlideId).select("type").lean();
        if (slide) {
          await syncer.broadcastSlideAnalytics(sessionId, activeSession.currentSlideId, slide.type);
        }
      }
    }

    // Step B: Broadcast a fresh state payload to EVERYONE ELSE in the room because the participant count just went up
    await syncer.broadcastState(sessionId);
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
