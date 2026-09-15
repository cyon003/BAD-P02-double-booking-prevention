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