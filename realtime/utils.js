import { checkRateLimit } from "./rateLimiter.js";
import { performance } from "node:perf_hooks";

export const createAckWrapper = (socket) => {
  return (handler) =>
    async (...args) => {
      const tStart = performance.now();
      const ack =
        typeof args[args.length - 1] === "function" ? args.pop() : null;

      const identityId =
        socket.data?.userId ||
        socket.data?.participantId ||
        socket.user?._id?.toString() ||
        socket.participant?._id?.toString() ||
        socket.id;

      const tRateLimitStart = performance.now();
      const isAllowed = await checkRateLimit(identityId);
      const rateLimitMs = performance.now() - tRateLimitStart;

      if (!isAllowed) {
        if (ack) {
          ack({
            success: false,
            error: "Rate limit exceeded. Please slow down.",
          });
        }
        return;
      }

      try {
        const tHandlerStart = performance.now();
        const result = await handler(...args);
        const handlerMs = performance.now() - tHandlerStart;

        if (ack) {
          ack({ success: true, data: result });
        }

        const totalMs = performance.now() - tStart;
        if (totalMs > 100) {
          console.log(
            `[Slow WS Event] total: ${totalMs.toFixed(1)}ms | rateLimit: ${rateLimitMs.toFixed(1)}ms | handler: ${handlerMs.toFixed(1)}ms`,
          );
        }
      } catch (error) {
        console.error("[Socket Error]", error.message || error);
        if (ack) {
          ack({
            success: false,
            error: error.message || "Internal Server Error",
          });
        }
      }
    };
};
