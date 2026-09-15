Issue #10 --- Add Automated Tests

Goal

Automatically verify the important backend behavior and detect
regressions before the final demo.

Tests to Cover

At minimum, test the available features:

Health endpoint
Course read API
Booking read API
Experiment reset
Unsafe booking with a normal request
Safe booking with a normal request
Safe booking capacity protection
Idempotency duplicate protection

Important Concurrency Test

For a course/resource with an allowed booking count of 1:

Reset
↓
Send concurrent requests to SAFE endpoint
↓
Check database
↓
Final bookings must not exceed 1

Idempotency Test

Send request with key ABC123
↓
Send same request with ABC123 again
↓
Check database
↓
Only one logical booking exists

Expected Result

The team can run the automated tests before merging/final demonstration
and quickly see whether core functionality still works.

Done When

Core read APIs are tested.

Reset is tested.

Unsafe endpoint basic behavior is tested.

Safe endpoint is tested.

Safe concurrent capacity behavior is tested.

Idempotency is tested.

Test command and setup are documented.