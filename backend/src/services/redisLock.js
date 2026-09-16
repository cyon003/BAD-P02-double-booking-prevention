const crypto = require("crypto");
const redisClient = require("../config/redis");

// Default lock lifetime: 10 seconds
const DEFAULT_TTL = 10;

/*
 * Try to acquire a Redis lock.
 *
 * Returns a unique token if successful.
 * Returns null if another request already owns the lock.
 */
async function acquireLock(lockKey, ttl = DEFAULT_TTL) {
  if (!lockKey) {
    throw new Error("Lock key is required");
  }

  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error("Lock TTL must be a positive integer");
  }

  const token = crypto.randomUUID();

  try {
    const result = await redisClient.set(lockKey, token, {
      NX: true,
      EX: ttl,
    });

    if (result === "OK") {
      return token;
    }

    return null;
  } catch (error) {
    console.error("Failed to acquire Redis lock:", error);
    throw error;
  }
}

/*
 * Release the lock only if this request owns it.
 *
 * The Lua script performs the check and delete atomically.
 */
async function releaseLock(lockKey, token) {
  if (!lockKey || !token) {
    throw new Error("Lock key and token are required");
  }
  
  const releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  try {
    const result = await redisClient.eval(releaseScript, {
      keys: [lockKey],
      arguments: [token],
    });

    return result === 1;
  } catch (error) {
    console.error("Failed to release Redis lock:", error);
    throw error;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
};
