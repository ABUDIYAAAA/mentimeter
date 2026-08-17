import { Server } from "socket.io";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { socketAuthMiddleware } from "./auth.js";
import { createAckWrapper } from "./utils.js";
import {
  handleConnection,
  handleDisconnection,
} from "./handlers/connectionHandlers.js";
import {
  handleSessionStatusChange,
  handleSlideChange,
  handleToggleVotingLock,
} from "./handlers/hostHandlers.js";
import { handleSubmitResponse } from "./handlers/participantHandlers.js";

const loopHistogram = monitorEventLoopDelay({ resolution: 20 });
loopHistogram.enable();

setInterval(() => {
  const p99 = (Number(loopHistogram.percentile(99)) / 1e6).toFixed(2);
  const max = (Number(loopHistogram.max) / 1e6).toFixed(2);
  const mean = (Number(loopHistogram.mean) / 1e6).toFixed(2);
  const mem = process.memoryUsage();
  console.log(
    `[EventLoop Monitor] p99: ${p99}ms | max: ${max}ms | mean: ${mean}ms | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB / RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
  );
  loopHistogram.reset();
}, 5000);

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
    socket.on("toggle_voting_lock", withAck((data) => handleToggleVotingLock(socket, data)));

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
