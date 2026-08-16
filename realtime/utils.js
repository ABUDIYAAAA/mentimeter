import { checkRateLimit } from "./rateLimiter.js";

export const createAckWrapper = (socket) => {
  return (handler) =>
    async (...args) => {
      const ack =
        typeof args[args.length - 1] === "function" ? args.pop() : null;

      const identityId = socket.user
        ? socket.user._id.toString()
        : socket.participant._id.toString();
      const isAllowed = await checkRateLimit(identityId);

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
        const result = await handler(...args);
        if (ack) {
          ack({ success: true, data: result });
        }
      } catch (error) {
        console.error("Socket Error:", error);
        if (ack) {
          ack({
            success: false,
            error: error.message || "Internal Server Error",
          });
        }
      }
    };
};
