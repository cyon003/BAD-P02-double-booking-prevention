Issue #3 --- Implement Unsafe Booking Endpoint

Goal

Create a booking endpoint without Redis locking so the team can
reproduce and demonstrate the race-condition/double-booking problem.

Endpoint

POST /api/bookings/unsafe

Required Flow

Request arrives
      ↓
Read latest course availability
      ↓
Check whether a place is available
      ↓
Create/update booking
      ↓
Save result in Neon
      ↓
Return response

Important

Do not use the Redis distributed lock in this endpoint.

This endpoint is intentionally the unsafe version used for the project's
before Redis experiment.

Experiment

Use a course such as:

Course: CS101
Maximum available place: 1
Starting bookings: 0

The testing tool will send 20 requests concurrently to this endpoint.

Because requests may read the same state before another request finishes
updating it, a race condition may occur.

Request A → sees 1 available
Request B → sees 1 available
Request C → sees 1 available

The final number of bookings must come from the real experiment.

Do not hard-code the result as 20 bookings. Sending 20 requests
might produce 2, 5, 10, 20, or another result depending on timing.

Expected Result

The endpoint gives us an unprotected baseline that can be compared with
the Redis-protected endpoint.

Done When

POST /api/bookings/unsafe works.

It reads/writes real Neon data.

It does not use Redis locking.

A normal single booking works.

Concurrent requests can be sent to it.

Final bookings can be checked using the booking read API.

Experiment setup

Call `POST /api/test/reset` before each run. Set
`UNSAFE_BOOKING_DELAY_MS` to widen the gap between the capacity check and
the insert when reproducing the race condition.

Verified Neon development run (20 requests, 2026-09-21)

- Successful bookings: 2
- Conflicts: 18
- Other errors: 0
- Final confirmed bookings: 2
- Capacity: 1
- Double booking detected: YES

The runner alternates between two students, and the database's unique
student/course constraint turns duplicate attempts into conflicts. The
authoritative database count still exceeded capacity, confirming the
unsafe race condition.
