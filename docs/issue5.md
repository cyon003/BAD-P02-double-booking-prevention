Issue #5 --- Build Concurrent Booking Test Runner

Goal

Simulate many users trying to book the same limited resource at almost
the same time.

Requirements

The tester should allow us to choose a number of requests, for example:

5
10
20
50

It must send the requests concurrently rather than waiting for each
request to finish before sending the next one.

Must Test Both Endpoints

POST /api/bookings/unsafe
POST /api/bookings/safe

Use the same request count and booking data when comparing them.

Experiment Flow

Without Redis

Reset
↓
Send 20 concurrent requests
↓
/api/bookings/unsafe
↓
Collect responses
↓
Check final database state

With Redis

Reset
↓
Send the SAME 20 concurrent requests
↓
/api/bookings/safe
↓
Collect responses
↓
Check final database state

Data to Collect

At minimum:

Requests sent
Successful responses
Rejected/failed responses
Actual bookings created
Final available state
Double booking detected: YES / NO

Important

Do not assume 20 concurrent requests will create exactly 20 unsafe
bookings. Record the real result.

Expected Result

The same test runner can produce comparable evidence for both the unsafe
and protected booking implementations.

Done When

Requests are actually sent concurrently.

Request count is configurable.

Unsafe endpoint can be tested.

Safe endpoint can be tested.

Responses are counted.

Final database state is checked.

Results can be passed to the frontend/report.
## Why the Unsafe Baseline Exists

The `POST /api/bookings/unsafe` endpoint was implemented strictly for the test environment. It perfectly mirrors the regular booking and database validation flow, but intentionally omits the Redis distributed lock (`acquireLock`).

By comparing the Safe and Unsafe endpoints under identical concurrent conditions, we establish a baseline that proves the race condition is real, and that the Redis lock is precisely the mechanism preventing it.

## How to Run Both Tests

You can run the tests using the `concurrentRunner.js` script with the `--url` flag to specify which endpoint to target.

**Test the Unsafe Endpoint (Baseline):**
```bash
node src/concurrentRunner.js --url http://localhost:5051/api/bookings/unsafe --requests 20 --course 1
```

**Test the Safe Endpoint (Protected):**
```bash
node src/concurrentRunner.js --url http://localhost:5051/api/bookings/safe --requests 20 --course 1
```

## Actual Results (20 Concurrent Requests)

| Test | Requests | Successful | Conflicts | DB Bookings | Capacity | Double Booking |
|------|----------:|-----------:|----------:|------------:|---------:|----------------|
| Unsafe | 20 | 10 | 10 | 10 | 1 | YES |
| Safe | 20 | 1 | 19 | 1 | 1 | NO |

* **Unsafe Conclusion:** The lack of a distributed lock allowed 10 requests to read `capacity > bookings` simultaneously before any of them could update it. This resulted in 10 actual database records being inserted, violating the capacity constraint (FAIL).
* **Safe Conclusion:** The Redis lock forced the requests to process sequentially or fail fast. Only 1 request acquired the lock and inserted a record. The remaining 19 requests failed safely (PASS).

## Done When Checklist
- [x] Requests are actually sent concurrently.
- [x] Request count is configurable.
- [x] Unsafe endpoint can be tested (Baseline implemented and tested).
- [x] Safe endpoint can be tested.
- [x] Responses are counted.
- [x] Final database state is checked.
- [x] Results can be passed to the frontend/report.
