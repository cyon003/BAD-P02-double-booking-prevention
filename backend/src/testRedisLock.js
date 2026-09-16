require("dotenv").config();

const redisClient = require("./config/redis");
const {
  acquireLock,
  releaseLock,
} = require("./services/redisLock");

async function testRedisLock() {
  const lockKey = "booking:course:1";

  try {
    await redisClient.connect();

    // Clean up an old test lock if one exists
    await redisClient.del(lockKey);

    console.log("\n--- Redis Lock Test ---");

    // Request A tries to acquire the lock
    const tokenA = await acquireLock(lockKey);

    console.log(
      "Request A acquire:",
      tokenA ? "SUCCESS" : "FAILED"
    );

    // Request B tries while A owns the lock
    const tokenB = await acquireLock(lockKey);

    console.log(
      "Request B acquire while A owns lock:",
      tokenB ? "SUCCESS (ERROR)" : "BLOCKED (CORRECT)"
    );

    // Fake/wrong owner tries to release A's lock
    const wrongRelease = await releaseLock(
      lockKey,
      "wrong-token"
    );

    console.log(
      "Wrong owner release:",
      wrongRelease ? "RELEASED (ERROR)" : "BLOCKED (CORRECT)"
    );

    // A releases its own lock
    const releaseA = await releaseLock(lockKey, tokenA);

    console.log(
      "Request A release:",
      releaseA ? "SUCCESS" : "FAILED"
    );

    // B tries again after A releases
    const tokenBAfterRelease = await acquireLock(lockKey);

    console.log(
      "Request B acquire after release:",
      tokenBAfterRelease ? "SUCCESS" : "FAILED"
    );

    if (tokenBAfterRelease) {
      await releaseLock(lockKey, tokenBAfterRelease);
    }
    
    console.log("\n--- TTL Expiration Test ---");

    const ttlLockKey = "booking:course:ttl-test";

    await redisClient.del(ttlLockKey);

    // Acquire a lock with a short 3-second TTL
    const ttlTokenA = await acquireLock(ttlLockKey, 3);

    console.log(
      "Request A acquire TTL lock:",
      ttlTokenA ? "SUCCESS" : "FAILED"
    );

    // B should be blocked immediately
    const ttlTokenB = await acquireLock(ttlLockKey, 3);

    console.log(
      "Request B before expiry:",
      ttlTokenB ? "SUCCESS (ERROR)" : "BLOCKED (CORRECT)"
    );

    console.log("Waiting 4 seconds for lock to expire...");

    await new Promise((resolve) => setTimeout(resolve, 4000));

    // After expiry, B should now be able to acquire
    const ttlTokenBAfterExpiry = await acquireLock(ttlLockKey, 3);

    console.log(
      "Request B after expiry:",
      ttlTokenBAfterExpiry ? "SUCCESS" : "FAILED"
    );

    if (ttlTokenBAfterExpiry) {
      await releaseLock(ttlLockKey, ttlTokenBAfterExpiry);
    }

  } catch (error) {
    console.error("Redis lock test failed:", error);
  } finally {
    await redisClient.quit();
  }
}

testRedisLock();
