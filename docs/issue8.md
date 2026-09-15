Issue #8 --- Add Database Transaction and Safety

Goal

Use Neon PostgreSQL as the final source of truth and prevent protected
booking operations from leaving invalid or half-completed data.

Requirements

Use a database transaction for related protected booking operations.

Example:

BEGIN
  ↓
Read/check required database state
  ↓
Update availability / create booking
  ↓
Everything successful?
    /        \
   NO        YES
   ↓          ↓
ROLLBACK    COMMIT

Add an appropriate database safety rule, constraint, or atomic
conditional update for the actual booking model.

Important

Coordinate this issue with CY's safe endpoint.

The final protected flow should be:

Redis lock
    ↓
Neon transaction/database safety
    ↓
Valid booking

Do not blindly add a uniqueness rule if the real data model legitimately
allows multiple bookings for a course with capacity greater than one.

Also keep /api/bookings/unsafe available separately for the
race-condition demonstration.

Expected Result

A failed protected booking cannot leave half-finished database changes,
and the database helps enforce valid final state.

Done When

Protected booking DB operations use a transaction where needed.

Successful operation commits.

Failed operation rolls back.

Appropriate DB-level safety is implemented for the actual
schema.

CY can use the database logic from the safe endpoint.

Unsafe experimental endpoint still remains available.