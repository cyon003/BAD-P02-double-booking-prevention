Issue #7 --- Implement Redis-Protected Safe Booking Endpoint

Goal

Create the protected booking endpoint that uses the Redis distributed
lock before changing booking data.

Endpoint

POST /api/bookings/safe

Required Flow

Booking request
      ↓
Validate input
      ↓
Create resource lock key
      ↓
Try to acquire Redis lock
      ↓
Lock acquired?
   /          \
  NO          YES
  ↓            ↓
Return busy/   Read latest state
conflict       from Neon
                 ↓
           Place available?
             /        \
            NO        YES
            ↓          ↓
          Reject    Perform protected
                    database booking
                         ↓
                      Commit
                         ↓
                  Release Redis lock
                         ↓
                      Success

Important

Redis is not the source of booking data.

Redis = concurrency control
Neon = source of truth

Always check the latest database state after acquiring the lock.

Reuse the shared booking/database logic from Teammate 1 where possible.

Always release the lock in a finally/error-safe path.

Final Experiment

Starting state:

CS101
Allowed place: 1
Bookings: 0

Send:

20 concurrent requests

to:

POST /api/bookings/safe

The protected database state must never exceed the allowed capacity.

For a one-place experiment, the expected final valid booking count is 1.

Done When

Safe endpoint works.

Redis lock is acquired before critical booking work.

Latest Neon state is checked while protected.

Valid booking is stored in Neon.

Capacity cannot be exceeded.

Lock is released after success.

Lock is released after errors.

Concurrent tester can test the endpoint