# Double-booking comparison

The React dashboard compares a deliberately unsafe check-then-insert endpoint
with the protected Redis lock + PostgreSQL transaction + atomic seat claim.
Database constraints and idempotency remain enabled.

## Run the demo

Configure `backend/.env` from `.env.example`, with `PORT=5050`,
`NODE_ENV=development`, and `EXPERIMENT_COURSE_ID=1`. Start the backend with
`npm run dev` in `backend` and the frontend with `npm run dev` in `frontend`.
The frontend calls `http://localhost:5050/api`.

The configured course must already exist. Reset preserves its capacity, deletes
its bookings, restores available seats, and creates any missing demo students
1–15 without overwriting existing students. For the comparison, use capacity 2
and 12 concurrent requests. Reset is restricted to development/test environments.

Each reset returns a new run ID. The dashboard uses it to namespace idempotency
keys, retaining the same key for retries within a run. Prior Redis records are
not flushed: they expire after one hour and cannot collide with new run keys.
Manual clients must also use fresh keys after reset; an old key intentionally
continues to replay its old result. Reset respects the course lock instead of
deleting another request's lock. Abandoned locks expire after 10 seconds.

Run experiments one at a time. Buttons are disabled until all requests and DB
verification finish. Concurrent experiments in separate tabs/processes are not
isolated; the unsafe endpoint intentionally does not participate in locking.

## Expected results

| 12 requests, capacity 2 | Safe | Unsafe |
| --- | --- | --- |
| Final successful requests | 2 | Variable; can exceed 2 |
| Other final responses | `409 COURSE_FULL` | Usually `409 COURSE_FULL` |
| Confirmed DB bookings | 2 | Can exceed capacity |
| Remaining seats | 0 | Usually 0; cannot go negative |
| Dashboard status | SAFE | DETECTED if overbooked or seat count is inconsistent; otherwise INCONCLUSIVE |

The safe API retains its immediate `409 BOOKING_IN_PROGRESS` contention response.
The dashboard and CLI retry **only** that response, with jitter and a 15-second
retry budget. They retain idempotency keys throughout retries and expose final
status/error categories. The dashboard also shows every attempt and response
body, so retry responses are not confused with final request outcomes. Network,
reset, verification, invalid-input, missing-student, and server errors are visible.
A batch with zero bookings is never displayed as SAFE.

The unsafe endpoint's existing read/check/insert race window defaults to 100 ms.
Set `UNSAFE_BOOKING_DELAY_MS=0` to remove the artificial delay or increase it to
make overlap more likely. The delay never fabricates results: the dashboard
checks committed rows. Race outcomes remain nondeterministic. The seat-counter
checks and unique student/course constraint do not impose a cross-row limit on
confirmed bookings, so no constraints need to be removed for this experiment.

## Cause of the original misleading result

The database initially had only students 1 and 2, but the dashboard requested
students 1–12. The formula `(i % 15) || 15` was correct for 1–15; the data was
missing. When a nonexistent student acquired the safe lock first, it returned
`404 STUDENT_NOT_FOUND` while the eleven other requests returned
`409 BOOKING_IN_PROGRESS`. No booking was committed. The old UI hid these
responses and labeled any non-overbooked database SAFE. With only two valid
students, the unsafe experiment also could not exceed capacity 2.

## Verification

Run these sequentially against a disposable development experiment database,
with PostgreSQL and Redis available. The live test additionally requires the
backend running on port 5050. Do not run other experiments during these tests.

```sh
cd backend
npm test -- --runInBand
node --test tests/experiment.integration.mjs
cd ../frontend
node --test tests/experiment.test.mjs
npm run build
npm run lint
```

The live integration test uses the dashboard's request functions and runs
Reset → Unsafe → Reset → Safe twice with 12 students/capacity 2. It checks API
results against PostgreSQL after each batch and verifies idempotent replay.
It reports unsafe outcomes without asserting a nondeterministic race must occur.
It resets bookings and restores the original capacity when finished.

## CLI runner

Reset first (this also seeds the demo students), then run from `backend`:

```sh
curl -X POST http://localhost:5050/api/test/reset
node src/concurrentRunner.js --url http://localhost:5050/api/bookings/safe --requests 12 --course 1

curl -X POST http://localhost:5050/api/test/reset
node src/concurrentRunner.js --url http://localhost:5050/api/bookings/unsafe --requests 12 --course 1
```

The runner defaults to 100 requests and cycles through IDs 1–15. Use at most 15
requests for distinct-student comparisons; larger batches can produce duplicate
booking responses. It verifies database state using the backend's `DATABASE_URL`;
ensure that configuration matches the server being tested. Its final PASS/FAIL
is a safety check, so an unsafe overbooking demonstration correctly reports FAIL.
