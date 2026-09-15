# BAD-P02 --- Double Booking Prevention Using Redis

## 1. Project Overview

This project demonstrates a **race condition in a booking system** and
implements a solution to prevent invalid double booking.

The main experiment uses one limited booking resource. For the current
system, **CS101 with only 1 available place** can be used as the test
resource.

Multiple booking requests are sent at almost the same time.

The project first runs the booking process **without Redis protection**
to demonstrate the race-condition risk. It then resets the data and runs
the same experiment again **with Redis locking**.

The final system compares the actual results of both experiments.

``` text
WITHOUT REDIS
Concurrent requests
      ↓
Unsafe booking
      ↓
Race condition may occur
      ↓
Possible invalid booking state


WITH REDIS
Same concurrent requests
      ↓
Redis-protected booking
      ↓
Controlled access
      ↓
Valid booking state
```

The purpose is not simply to create a booking website. The main purpose
is to **demonstrate the concurrency problem, implement a solution, and
provide evidence that the solution works**.

------------------------------------------------------------------------

## 2. Main Project Goal

The project should prove the following:

> When multiple users try to book the same limited resource
> concurrently, an unprotected booking process can suffer from a race
> condition. Redis distributed locking, together with PostgreSQL
> database safety and idempotency protection, can prevent the protected
> booking flow from creating an invalid booking state.

The project therefore has two important states:

1.  **Without Redis --- Problem State**
2.  **With Redis --- Protected State**

Both states are required for the final comparison.

------------------------------------------------------------------------

## 3. Example Final Experiment

Assume the starting state is:

``` text
Course: CS101
Maximum available place: 1
Bookings: 0
Concurrent requests: 20
```

### Experiment A --- Without Redis

``` text
Reset experiment
      ↓
CS101 has 1 available place
      ↓
Send 20 booking requests concurrently
      ↓
POST /api/bookings/unsafe
      ↓
No Redis distributed lock
      ↓
Multiple requests may read the same availability
      ↓
Race condition may occur
      ↓
Check actual Neon database state
```

Example race:

``` text
Request A reads → 1 available
Request B reads → 1 available
Request C reads → 1 available

The requests overlap before the previous booking finishes.
```

This may create more bookings than the allowed state.

The exact result must come from the real test.

For example:

``` text
Requests sent: 20
Allowed bookings: 1
Bookings created: 6
Double booking: YES
```

`6` is only an example. The system must **not hard-code** that 20
requests produce 20 bookings. Race-condition results depend on timing.

### Experiment B --- With Redis

Reset the experiment again to exactly the same starting state.

``` text
Reset experiment
      ↓
CS101 has 1 available place
      ↓
Send the SAME 20 requests concurrently
      ↓
POST /api/bookings/safe
      ↓
Redis distributed lock
      ↓
Protected booking/database operation
      ↓
Check actual Neon database state
```

Expected protected state:

``` text
Allowed bookings: 1
Final valid bookings: 1
Double booking: NO
```

The exact number of HTTP rejected/busy responses depends on the final
implementation, but the protected database state must not exceed the
allowed booking capacity.

------------------------------------------------------------------------

## 4. Final User Experience

After the frontend and backend are integrated, a user/tester should be
able to:

1.  Open the React frontend.
2.  See the test course and current availability.
3.  Choose the number of concurrent requests.
4.  Run the **Without Redis** experiment.
5.  See the actual unsafe result.
6.  Reset the experiment.
7.  Run the **With Redis** experiment.
8.  See the protected result.
9.  Compare both results side-by-side.

Example frontend:

``` text
================================================
          DOUBLE BOOKING PREVENTION
================================================

Course: CS101
Maximum Available Place: 1

Concurrent Requests: [ 20 ]

[ Run Without Redis ]
[ Reset Experiment ]
[ Run With Redis ]

------------------------------------------------
RESULTS
------------------------------------------------
                    WITHOUT REDIS   WITH REDIS

Requests Sent            20             20
Bookings Created       actual          actual
Allowed                    1              1
Rejected                actual          actual
Double Booking          YES/NO            NO

------------------------------------------------
```

The displayed values must come from the real experiment.

------------------------------------------------------------------------

## 5. Technology Stack

### Frontend

``` text
React
Vite
```

Purpose:

-   Provide the experiment interface.
-   Display course/booking information.
-   Start unsafe and safe tests.
-   Reset the experiment.
-   Display and compare results.

### Backend

``` text
Node.js
Express.js
```

Purpose:

-   Provide REST APIs.
-   Handle booking requests.
-   Connect the frontend, Redis, and Neon.
-   Implement unsafe and safe booking flows.
-   Handle validation and errors.

### Database

``` text
Neon PostgreSQL
```

Purpose:

-   Store courses.
-   Store bookings.
-   Store persistent application state.
-   Act as the source of truth.
-   Provide transaction/database-level safety.

### Concurrency Protection

``` text
Redis
```

Purpose:

-   Create a temporary distributed lock for the resource being booked.
-   Prevent multiple protected requests from entering the same critical
    booking section simultaneously.

Redis does **not** replace Neon.

``` text
Redis = concurrency control
Neon = persistent source of truth
```

------------------------------------------------------------------------

## 6. System Architecture

``` text
                         USER
                          |
                          v
                  +----------------+
                  | React Frontend |
                  |     Vite       |
                  +----------------+
                          |
                     HTTP / API
                          |
                          v
                 +-----------------+
                 | Node.js/Express |
                 |     Backend     |
                 +-----------------+
                    /           \
                   /             \
                  v               v
          +---------------+  +----------------+
          |     Redis     |  |      Neon      |
          | Lock /        |  |   PostgreSQL   |
          | Concurrency   |  | Source of Truth|
          +---------------+  +----------------+
```

------------------------------------------------------------------------

## 7. Main Backend APIs

The planned system uses APIs similar to:

### Health

``` http
GET /api/health
```

Checks whether the backend and Redis connection are working.

### Courses

``` http
GET /api/courses
```

Returns course information from Neon.

### Bookings

``` http
GET /api/bookings
```

Returns current bookings.

### Unsafe Booking

``` http
POST /api/bookings/unsafe
```

Creates a booking without Redis locking.

Purpose:

``` text
Demonstrate the original race-condition problem.
```

### Safe Booking

``` http
POST /api/bookings/safe
```

Uses Redis locking and protected database logic.

Purpose:

``` text
Demonstrate the solution.
```

### Experiment Reset

``` http
POST /api/experiment/reset
```

Restores the agreed test course and booking data to the initial state.

------------------------------------------------------------------------

## 8. Unsafe Booking Flow

The unsafe endpoint intentionally does not use the Redis lock.

``` text
Request
   ↓
Read availability from Neon
   ↓
Availability > 0?
   ↓
Create/update booking
   ↓
Save to Neon
```

The concurrency problem occurs because several requests can overlap.

``` text
Time →

Request A: READ available=1 -------- CREATE
Request B:    READ available=1 -------- CREATE
Request C:       READ available=1 -------- CREATE
```

Each request may make its decision using stale information.

This endpoint exists for the experiment. It is **not** the booking flow
that would be exposed as the final production solution.

------------------------------------------------------------------------

## 9. Redis Distributed Lock

The protected booking flow uses a Redis lock for the resource.

Example lock key:

``` text
booking:course:1
```

Conceptually, lock acquisition uses:

``` text
SET <lock-key> <unique-token> NX EX <ttl>
```

Where:

``` text
NX
= create the lock only if it does not already exist

EX
= automatically expire the lock after a short period

unique token
= identifies the request that owns the lock
```

Example:

``` text
Request A → gets lock 🔒

Request B → same lock busy
Request C → same lock busy

Request A finishes
      ↓
releases its lock
```

The lock must have an expiry time so a crash cannot permanently lock the
resource.

Lock release should also verify ownership so one request cannot
accidentally remove another request's newer lock.

------------------------------------------------------------------------

## 10. Safe Booking Flow

The protected endpoint should follow this general process:

``` text
Booking request
      ↓
Validate request
      ↓
Create lock key
      ↓
Acquire Redis lock
      ↓
Lock acquired?
   /          \
  NO          YES
  ↓            ↓
Return        Read latest state
busy/error    from Neon
                 ↓
          Availability?
            /        \
           NO        YES
           ↓          ↓
         Reject    Start protected
                   DB operation
                        ↓
                   Create booking
                        ↓
                      Commit
                        ↓
                  Release lock
                        ↓
                     Success
```

The important point is that availability is checked again using the
latest database state **after the Redis lock is acquired**.

------------------------------------------------------------------------

## 11. Database Transaction and Safety

Redis is the first concurrency-control layer, but the database remains
the final source of truth.

Protected database operations that belong together should use a
PostgreSQL transaction where appropriate.

``` text
BEGIN
  ↓
Check/update required state
  ↓
Create booking
  ↓
Everything successful?
   /        \
  NO        YES
  ↓          ↓
ROLLBACK   COMMIT
```

The team should also use an appropriate database constraint, atomic
conditional update, or other database-level rule for the actual schema.

The exact constraint must match the data model. A rule should not
accidentally prevent legitimate multiple bookings when a resource
actually has capacity greater than one.

------------------------------------------------------------------------

## 12. Idempotency Protection

Redis locking and idempotency solve different problems.

### Redis Lock

Protects the shared booking resource from concurrent requests.

### Idempotency

Protects the system when the **same logical request** is repeated.

Example causes:

``` text
Double-click
Browser retry
Network retry
```

Example:

``` http
Idempotency-Key: ABC123
```

Flow:

``` text
First ABC123
     ↓
Process booking
     ↓
Store result

ABC123 sent again
     ↓
Already processed
     ↓
Do not create another booking
```

This prevents duplicate bookings caused by retries rather than by
different users competing concurrently.

------------------------------------------------------------------------

## 13. Concurrent Request Testing

A test runner will simulate multiple users.

Example:

``` text
20 requests
     |
     +---- Request 1
     +---- Request 2
     +---- Request 3
     +---- ...
     +---- Request 20
             |
             v
        Booking API
```

The requests should be sent concurrently rather than one after another.

The same test conditions must be used for both modes.

``` text
WITHOUT Redis
20 concurrent requests

WITH Redis
20 concurrent requests
```

This creates a fair comparison.

------------------------------------------------------------------------

## 14. Results to Record

For each experiment, record at least:

``` text
Requests sent
Successful responses
Rejected/failed responses
Actual bookings created
Allowed bookings
Final availability
Double booking detected: YES / NO
```

Example final comparison:

  Measurement              Without Redis      With Redis
  ---------------------- --------------- ---------------
  Concurrent requests                 20              20
  Allowed bookings                     1               1
  Successful responses     Actual result   Actual result
  Rejected responses       Actual result   Actual result
  Final bookings           Actual result   Actual result
  Double booking                  YES/NO              NO

The report and presentation should use **real test results**, not
predetermined values.

------------------------------------------------------------------------

## 15. Team Responsibilities

### CY --- Redis and Protected Booking

Issues:

``` text
#6 Redis Distributed Lock
#7 Safe Booking Endpoint
#9 Idempotency Protection
```

Main responsibility:

``` text
Build the solution that prevents invalid concurrent booking.
```

Expected contribution:

``` text
Redis lock
      ↓
Safe booking API
      ↓
Idempotency
      ↓
Protected booking behavior
```

### Teammate 1 --- Booking API and Neon

Issues:

``` text
#2 Course and Booking Read APIs
#3 Unsafe Booking Endpoint
#4 Experiment Reset
#8 Database Transaction and Safety
```

Main responsibility:

``` text
Build the database/booking foundation and the unprotected baseline.
```

Expected contribution:

``` text
Neon data
     ↓
Unsafe booking
     ↓
Race-condition experiment
     ↓
Reset
     ↓
Database safety for protected flow
```

### Teammate 2 --- Testing and Frontend

Issues:

``` text
#5 Concurrent Request Test Runner
#10 Automated Tests
#11 Load and Failure Experiments
#12 Frontend Comparison Dashboard
```

Main responsibility:

``` text
Generate the concurrency, prove the result, and show it visually.
```

Expected contribution:

``` text
Concurrent requests
       ↓
Collect actual results
       ↓
Automated/load testing
       ↓
React comparison dashboard
```

### Everyone

Issue:

``` text
#13 Documentation and Presentation
```

------------------------------------------------------------------------

## 16. How the Three Members' Work Connects

``` text
                        FRONTEND
                       Teammate 2
                           |
                Run concurrency tests
                           |
              +------------+------------+
              |                         |
              v                         v
       WITHOUT REDIS               WITH REDIS
       Teammate 1                     CY
              |                         |
       Unsafe Booking              Safe Booking
              |                         |
              |                    Redis Lock
              |                         |
              +------------+------------+
                           |
                           v
                    Neon PostgreSQL
                           |
                           v
                    Actual DB Result
                           |
                           v
                       Frontend
                    Compare Results
```

No teammate is building a separate application. All work becomes part of
the same system.

------------------------------------------------------------------------

## 17. Development Schedule

### September 15

CY: - Start Redis distributed lock.

Teammate 1: - Complete/read API work. - Start unsafe booking.

Teammate 2: - Start concurrent request runner. - Continue frontend
structure.

### September 16

CY: - Finish Redis lock.

Teammate 1: - Finish unsafe booking. - Finish experiment reset.

Teammate 2: - Finish concurrent runner. - Begin testing unsafe endpoint.

### September 17

CY: - Start safe booking endpoint.

Teammate 1: - Start database transaction/safety work.

Teammate 2: - Connect frontend/testing to merged APIs. - Start automated
tests.

### September 18

CY: - Finish safe booking. - Start idempotency.

Teammate 1: - Finish database safety. - Help integrate safe booking.

Teammate 2: - Finish automated tests. - Start load/failure testing.

### September 19

CY: - Finish idempotency. - Integration/fixes.

Teammate 1: - Integration/fixes.

Teammate 2: - Run final experiments. - Finish frontend comparison
dashboard.

### September 20

Everyone:

``` text
Merge all completed work
Run complete experiment
Fix integration problems
Record final results
Take screenshots
Complete documentation
Prepare presentation
```

### September 21

Everyone:

``` text
Final verification
Final demo rehearsal
Presentation
Submission
```

------------------------------------------------------------------------

## 18. Git Workflow

Do not develop directly on `main`.

Before starting an issue:

``` bash
git checkout main
git pull origin main
git checkout -b <issue-feature-branch>
```

After completing useful work:

``` bash
git status
git add <files>
git commit -m "<clear commit message>"
git push -u origin <issue-feature-branch>
```

Then create a Pull Request.

After another teammate's Pull Request is merged:

``` bash
git checkout main
git pull origin main
```

Create the next feature branch from the updated `main`.

Small completed Pull Requests should be merged early so teammates can
integrate with each other's APIs.

Never commit:

``` text
.env
database passwords
Neon connection strings
secrets
node_modules
```

------------------------------------------------------------------------

## 19. Suggested Backend Structure

To reduce merge conflicts, keep responsibilities separated where
practical.

``` text
backend/
└── src/
    ├── config/
    │   ├── database.js
    │   └── redis.js
    │
    ├── routes/
    │   ├── bookingRoutes.js
    │   └── experimentRoutes.js
    │
    ├── services/
    │   ├── bookingService.js
    │   └── redisLock.js
    │
    └── server.js
```

Frontend:

``` text
frontend/
└── src/
    ├── App.jsx
    └── ...
```

Avoid having all three members make large unrelated edits to `server.js`
at the same time.

------------------------------------------------------------------------

## 20. Final Project Features

When the project is complete, the system should support:

-   Reading course information from Neon.
-   Reading current bookings.
-   Creating an intentionally unsafe booking for the experiment.
-   Resetting the experiment.
-   Simulating concurrent users.
-   Demonstrating race-condition/double-booking risk.
-   Creating a Redis-protected safe booking.
-   Using database transaction/safety rules.
-   Preventing duplicate retries with idempotency.
-   Running automated concurrency/load tests.
-   Displaying actual results in a React frontend.
-   Comparing **without Redis vs with Redis**.

------------------------------------------------------------------------

## 21. Final Demonstration Sequence

The final presentation/demo can follow this sequence:

``` text
1. Open frontend

2. Show CS101
   Available place = 1
   Bookings = 0

3. Select 20 concurrent requests

4. Run WITHOUT REDIS

5. Show actual result
   Example:
   Allowed = 1
   Actual bookings = more than 1
   DOUBLE BOOKING DETECTED

6. Reset

7. Confirm:
   Available place = 1
   Bookings = 0

8. Run WITH REDIS

9. Show protected result
   Allowed = 1
   Final valid bookings = 1
   DOUBLE BOOKING PREVENTED

10. Show side-by-side comparison
```

This provides a clear:

``` text
PROBLEM
   ↓
EVIDENCE
   ↓
SOLUTION
   ↓
EVIDENCE
```

------------------------------------------------------------------------

## 22. Project Success Criteria

The project is successful when:

-   [ ] Backend connects to Neon PostgreSQL.
-   [ ] Backend connects to Redis.
-   [ ] Course and booking data can be retrieved.
-   [ ] Unsafe booking endpoint exists.
-   [ ] Concurrent test can demonstrate the unprotected race-condition
    risk.
-   [ ] Experiment can be reset.
-   [ ] Redis distributed lock works.
-   [ ] Safe booking endpoint uses the lock correctly.
-   [ ] Protected database state cannot exceed the allowed booking
    capacity.
-   [ ] Database transaction/safety is implemented.
-   [ ] Duplicate logical requests are protected with idempotency.
-   [ ] Automated/concurrent tests pass.
-   [ ] Frontend can run/show both experiments.
-   [ ] Unsafe and safe results are compared using real data.
-   [ ] Documentation and presentation explain the result clearly.

------------------------------------------------------------------------

## 23. Short Project Explanation

> **BAD-P02 Double Booking Prevention** is a full-stack concurrency
> project that demonstrates how simultaneous booking requests can cause
> a race condition. The system first reproduces the problem using an
> unprotected Express booking endpoint. It then runs the same concurrent
> experiment using Redis distributed locking, Neon PostgreSQL database
> safety, and idempotency protection. A React frontend displays the
> actual results so users can compare the unprotected and protected
> booking states.
