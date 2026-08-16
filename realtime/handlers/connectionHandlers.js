import { Participant, Session } from "../../src/core/database/models/index.js";
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

    const roomName = `session_${sessionId}`;
    socket.join(roomName);

    socket.sessionId = sessionId;

    console.log(`[WS] Socket ${socket.id} joined room ${roomName}`);

    await syncer.sendStateToSocket(socket, sessionId);

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
