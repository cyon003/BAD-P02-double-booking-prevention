Issue #6 --- Implement Redis Distributed Lock

Goal

Create a reusable Redis lock that prevents multiple requests from
entering the same critical booking section at the same time.

Suggested File

backend/src/services/redisLock.js

Lock Key

Use a key that identifies the resource being booked.

Example:

booking:course:<courseId>

For course ID 1:

booking:course:1

Lock Acquisition

Use Redis atomic locking:

SET <lock-key> <unique-token> NX EX <ttl>

Where:

NX = create only when the lock does not already exist
EX = automatically expire the lock after a short time
unique-token = identifies the request that owns the lock

Required Behavior

Request A → acquire lock → success
Request B → same lock → unavailable
Request C → same lock → unavailable

Request A finishes
↓
Request A releases its own lock

Safe Release

Do not simply delete the lock without checking ownership.

The lock should only be deleted when the stored Redis token matches the
token belonging to the request releasing it. Use an atomic
compare-and-delete operation, such as a small Redis Lua script.

Failure Safety

The lock must have a TTL so it eventually disappears if a request
crashes.

Booking code using the lock should release it in an error-safe/finally
path.

Expected Result

Only one request can own the same booking lock at a time.

Done When

Lock can be acquired.

Second request cannot acquire the same active lock.

Every lock has an expiry time.

Every lock uses a unique owner token.

A request only releases its own lock.

Lock can be acquired again after release/expiry.

Redis errors are handled.