import Redis from "ioredis";
import env from "../env/env.js";

export const redis = new Redis(env.REDIS_URI);

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err));
