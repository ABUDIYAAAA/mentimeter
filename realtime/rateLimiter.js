import { redis } from "../src/core/database/redis.js";

// Leaky Bucket Lua Script
// KEYS[1] - The rate limit key for this user/action
// ARGV[1] - Capacity of the bucket (max burst)
// ARGV[2] - Leak rate (tokens leaked per second)
// ARGV[3] - Current timestamp (milliseconds)
// Returns 1 if allowed, 0 if rejected (Rate Limited)
const LEAKY_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leak_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local bucket = redis.call("HMGET", key, "water", "last_leak")
  local water = tonumber(bucket[1]) or 0
  local last_leak = tonumber(bucket[2]) or now

  -- Calculate how much water has leaked since last time
  local time_passed_sec = (now - last_leak) / 1000
  local leaked = time_passed_sec * leak_rate

  water = math.max(0, water - leaked)

  if water + 1 <= capacity then
    -- Allowed! Add a drop of water and update last_leak
    redis.call("HMSET", key, "water", water + 1, "last_leak", now)
    -- Expire the key after it fully leaks to save memory
    local ttl = math.ceil((water + 1) / leak_rate) + 2
    redis.call("EXPIRE", key, ttl)
    return 1
  else
    -- Rejected! Bucket is full. 
    -- Update the record of current water and last_leak so it continues to leak properly based on real time
    redis.call("HMSET", key, "water", water, "last_leak", now)
    return 0
  end
`;

redis.defineCommand("leakyBucket", {
  numberOfKeys: 1,
  lua: LEAKY_BUCKET_SCRIPT,
});

export const checkRateLimit = async (
  identityId,
  action = "ws_emit",
  capacity = 10,
  leakRate = 2,
) => {
  const key = `ratelimit:${action}:${identityId}`;
  const now = Date.now();

  try {
    const result = await redis.leakyBucket(key, capacity, leakRate, now);
    return result === 1;
  } catch (error) {
    console.error("[RateLimiter Error]", error);
    return true;
  }
};
