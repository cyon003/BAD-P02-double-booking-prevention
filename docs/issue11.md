Issue #11 --- Run Load and Failure Experiments

Goal

Run the real experiments that provide evidence for the report, frontend,
and presentation.

Main Comparison

Use exactly the same starting state and request count.

Example:

Course: CS101
Allowed place: 1
Concurrent requests: 20

Experiment A --- Without Redis

Reset
↓
20 concurrent requests
↓
POST /api/bookings/unsafe
↓
Collect responses
↓
Read final Neon state
↓
Record result

Experiment B --- With Redis

Reset
↓
Same 20 concurrent requests
↓
POST /api/bookings/safe
↓
Collect responses
↓
Read final Neon state
↓
Record result

Record

For each experiment:

Mode
Requests sent
Successful responses
Rejected/failed responses
Bookings created
Allowed bookings
Final availability
Double booking detected: YES / NO

Important

Use real measurements.

Do not write:

20 requests = 20 unsafe bookings

unless that is what actually happened.

Race-condition results depend on timing.

Extra Load Tests

If time allows, repeat with:

5 requests
10 requests
20 requests
50 requests

Failure Checks

Also verify useful failure cases such as:

Redis temporarily unavailable
Invalid course ID
No availability
Database error
Repeated idempotency key

The application should return controlled errors rather than crashing.

Done When

Unsafe experiment result is recorded.

Safe experiment result is recorded.

Same conditions are used for comparison.

Final Neon state is verified.

Failure cases are checked.

Results are ready for frontend/report/presentation.