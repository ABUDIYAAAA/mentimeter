import { Server } from "socket.io";
import { socketAuthMiddleware } from "./auth.js";
import { createAckWrapper } from "./utils.js";
import {
  handleConnection,
  handleDisconnection,
} from "./handlers/connectionHandlers.js";
import { handleSessionStatusChange, handleSlideChange } from "./handlers/hostHandlers.js";
import { handleSubmitResponse } from "./handlers/participantHandlers.js";

let io;

export const initRealtimeServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const withAck = createAckWrapper(socket);

    await handleConnection(socket);

    socket.on("change_session_status", withAck((data) => handleSessionStatusChange(socket, data)));
    socket.on("change_slide", withAck((data) => handleSlideChange(socket, data)));

    socket.on("submit_response", withAck((data) => handleSubmitResponse(socket, data)));

    socket.on(
      "ping",
      withAck(async (data) => {
        if (data?.fail) throw new Error("You asked me to fail!");
        return { pong: true, received: data };
      }),
    );

    socket.on("disconnect", async () => {
      await handleDisconnection(socket);
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
