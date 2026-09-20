Issue #4 --- Implement Experiment Reset Endpoint

Goal

Reset the test data so the unsafe and safe experiments always start from
the same state.

Endpoint

POST /api/test/reset

Required Starting State

For the agreed test course:

Course: CS101
Capacity / available place: 1
Test bookings: 0

Required Flow

Reset request
      ↓
Remove/reset test bookings
      ↓
Restore test course availability
      ↓
Return the new state

Why We Need This

The final demonstration should be fair:

RESET
↓
20 requests WITHOUT Redis
↓
Record result

RESET
↓
Same 20 requests WITH Redis
↓
Record result

Important

Only reset data that belongs to the experiment. Do not accidentally
delete unrelated database data.

Expected Result

The team can repeatedly return the experiment to the same starting
condition with one API request.

Done When

Reset endpoint works repeatedly.

Test bookings return to 0.

Course availability returns to the agreed starting value.

The endpoint returns the new/reset state.

Testing and frontend can call the endpoint.

Frontend handoff

Use `POST /api/test/reset`. Replace any existing `/api/experiment/reset`
calls with the canonical `/api/test/reset` path.
