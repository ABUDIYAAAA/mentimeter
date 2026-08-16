import { checkRateLimit } from "../../../realtime/rateLimiter.js";

export const rateLimitMiddleware =
  ({
    keyGenerator = (req) => (req.user ? req.user._id.toString() : req.ip),
    action = "http_request",
    capacity = 10,
    leakRate = 2,
  } = {}) =>
  async (req, res, next) => {
    try {
      const identityId = keyGenerator(req);

      if (!identityId) return next();

      const isAllowed = await checkRateLimit(
        identityId,
        action,
        capacity,
        leakRate,
      );

      if (!isAllowed) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please slow down.",
        });
      }

      next();
    } catch (error) {
      console.error("HTTP Rate Limiter Error:", error);
      next();
    }
  };
