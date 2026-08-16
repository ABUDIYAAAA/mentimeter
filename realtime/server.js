import { Server } from "socket.io";
import { socketAuthMiddleware } from "./auth.js";
import { createAckWrapper } from "./utils.js";

let io;

export const initRealtimeServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    const withAck = createAckWrapper(socket);
    const role = socket.user ? "Presenter" : "Participant";
    const identityId = socket.user ? socket.user._id : socket.participant._id;

    console.log(
      `[WS] ${role} connected: ${identityId} (Socket ID: ${socket.id})`,
    );

    socket.on(
      "ping",
      withAck(async (data) => {
        if (data?.fail) {
          throw new Error("You asked me to fail!");
        }
        return { pong: true, role, identityId, received: data };
      }),
    );

    socket.on("disconnect", () => {
      console.log(
        `[WS] ${role} disconnected: ${identityId} (Socket ID: ${socket.id})`,
      );
    });
  });

  return io;
};

export const getIo = () => {
  if (!io) {
    throw new Error("Socket.io has not been initialized!");
  }
  return io;
};
