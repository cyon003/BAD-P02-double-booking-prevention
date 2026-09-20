const redisClient = require("../config/redis");

// Remember an idempotency key for one hour.
const DEFAULT_TTL = 60 * 60;

function getRedisKey(idempotencyKey) {
  return `idempotency:booking:${idempotencyKey}`;
}

/*
 * Get an existing idempotency record.
 */
async function getIdempotencyRecord(idempotencyKey) {
  const value = await redisClient.get(
    getRedisKey(idempotencyKey)
  );

  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

/*
 * Atomically claim an idempotency key.
 *
 * NX means Redis only creates the key if it
 * does not already exist.
 */
async function claimIdempotencyKey(
  idempotencyKey,
  ttl = DEFAULT_TTL
) {
  const redisKey = getRedisKey(idempotencyKey);

  const record = {
    state: "processing",
  };

  const result = await redisClient.set(
    redisKey,
    JSON.stringify(record),
    {
      NX: true,
      EX: ttl,
    }
  );

  return result === "OK";
}

/*
 * Store the final successful response.
 *
 * A repeated request can return this result
 * without creating another booking.
 */
async function storeIdempotencyResult(
  idempotencyKey,
  statusCode,
  response,
  ttl = DEFAULT_TTL
) {
  const redisKey = getRedisKey(idempotencyKey);

  const record = {
    state: "completed",
    statusCode,
    response,
  };

  await redisClient.set(
    redisKey,
    JSON.stringify(record),
    {
      EX: ttl,
    }
  );
}

/*
 * Remove a key when processing failed before
 * the booking was committed.
 */
async function clearIdempotencyKey(idempotencyKey) {
  await redisClient.del(
    getRedisKey(idempotencyKey)
  );
}

module.exports = {
  getIdempotencyRecord,
  claimIdempotencyKey,
  storeIdempotencyResult,
  clearIdempotencyKey,
};