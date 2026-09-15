Issue #9 --- Add Idempotency / Duplicate Request Protection

Goal

Prevent the same logical booking request from creating a second booking
when it is repeated.

Problem Examples

User double-clicks Book
Browser retries a request
Network retry sends the same request again

Request Key

Support a unique request identifier such as:

Idempotency-Key: <unique-request-id>

Example:

Idempotency-Key: ABC123

Required Behavior

First request with ABC123
        ↓
Process booking
        ↓
Store/remember result

Same logical request with ABC123 again
        ↓
Recognize it was already processed
        ↓
Do NOT create another booking

A different idempotency key represents a new logical request.

Difference From Redis Lock

Redis distributed lock
= protects the shared resource from concurrent requests

Idempotency
= protects against the same logical request being repeated

The idempotency mechanism should be reliable for the project and should
not depend only on a temporary JavaScript in-memory object.

Expected Result

Repeated requests using the same idempotency key create at most one
booking.

Done When

Safe endpoint accepts an idempotency key.

First request is processed normally.

Repeated same key does not create another booking.

Different key can represent a new request.

Behavior can be verified by automated tests.