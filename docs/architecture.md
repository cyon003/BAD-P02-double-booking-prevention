# System Architecture & Workflows

## High-Level System Architecture

```mermaid
flowchart TD
    Client[Client / React Dashboard] -->|HTTP POST| API[Node.js / Express Backend]
    
    sublayer[Backend Services]
    API -->|Redis Lock| Redis[(Redis)]
    API -->|Idempotency| Redis
    API -->|Transaction| Postgres[(Neon / PostgreSQL)]
    
    subgraph Data Layer
        Postgres -->|Constraints| DB_Tables(bookings, courses, students)
    end
```

## Unsafe Booking Workflow

This workflow represents the vulnerability of a typical "Check-Then-Insert" race condition.

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant API as Backend (Unsafe)
    participant DB as PostgreSQL
    
    C1->>API: POST /api/bookings/unsafe
    C2->>API: POST /api/bookings/unsafe
    
    API->>DB: SELECT count(*) FROM bookings
    DB-->>API: 0 (Available)
    API->>DB: SELECT count(*) FROM bookings
    DB-->>API: 0 (Available)
    
    Note over API: Artificial Delay (100ms) widened race window
    
    API->>DB: INSERT INTO bookings (C1)
    DB-->>API: Success
    
    API->>DB: INSERT INTO bookings (C2)
    DB-->>API: Success
    
    Note over API,DB: Double Booking Occurred!
    API-->>C1: 201 Created
    API-->>C2: 201 Created
```

## Safe Booking Workflow

The safe endpoint provides complete protection against double-booking through Idempotency, Redis Distributed Locking, and atomic PostgreSQL database updates.

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant API as Backend (Safe)
    participant Redis as Redis
    participant DB as PostgreSQL
    
    C1->>API: POST /api/bookings/safe (Key A)
    C2->>API: POST /api/bookings/safe (Key B)
    
    Note over API,Redis: 1. Idempotency Check & Claim
    API->>Redis: claim idempotency key A
    Redis-->>API: OK
    API->>Redis: claim idempotency key B
    Redis-->>API: OK
    
    Note over API,Redis: 2. Distributed Lock
    API->>Redis: acquire lock (booking:course:1)
    Redis-->>API: Lock acquired (C1)
    
    API->>Redis: acquire lock (booking:course:1)
    Redis-->>API: Lock Failed (C2)
    API-->>C2: 409 BOOKING_IN_PROGRESS
    
    Note over API,DB: 3. Transaction & Validation
    API->>DB: BEGIN
    
    API->>DB: UPDATE courses SET available_seats = available_seats - 1 WHERE available_seats > 0 RETURNING *
    DB-->>API: Updated successfully
    
    API->>DB: INSERT INTO bookings
    DB-->>API: Inserted
    
    API->>DB: COMMIT
    
    Note over API,Redis: 4. Finalize & Unlock
    API->>Redis: Store idempotency result for Key A
    API->>Redis: Release lock (booking:course:1)
    
    API-->>C1: 201 Booking successful
```

## Redis Lock & PostgreSQL Transaction Relationship

The system relies on a two-tier locking mechanism to guarantee consistency and performance.

```mermaid
flowchart LR
    Request((Incoming Request))
    
    subgraph Tier 1: Application Level (Redis)
        RL[Redis Distributed Lock]
        RL_Desc[Prevents concurrent database connection saturation and immediate overlapping writes for the same course.]
    end
    
    subgraph Tier 2: Database Level (Postgres)
        PG[Atomic Update & Constraints]
        PG_Desc[Row-level locking during UPDATE and UNIQUE constraints provide the ultimate source of truth.]
    end
    
    Request -->|Requires| RL
    RL -->|Protects| PG
```

1. **Redis Distributed Lock (Tier 1):** Immediately rejects competing contenders (`409 BOOKING_IN_PROGRESS`) instead of queuing them. This protects the database from being flooded with overlapping transactions for a highly-contested resource.
2. **PostgreSQL Protection (Tier 2):** In the event the Redis lock fails, expires early, or is bypassed, the database uses atomic updates (`UPDATE ... WHERE available_seats > 0`) and unique constraints (`student_id, course_id`). This provides a mathematically sound limit on total bookings.

## Required Screenshots

*(The following screenshots should be captured and added to the `docs/images/` folder to complete the presentation).*

1. `![Dashboard Before Test](./images/dashboard-before.png)`: The frontend dashboard loaded with a freshly reset course.
2. `![Unsafe Test Result](./images/unsafe-result.png)`: Evidence of the unsafe experiment showing a double booking (e.g., booked > capacity).
3. `![Safe Test Result](./images/safe-result.png)`: Evidence of the safe experiment successfully limiting bookings to exact capacity and returning conflicts.
4. `![Automated Test Result](./images/automated-test.png)`: Terminal output showing all Jest automated tests passing (`npm test`). *(Note: This should be captured once the pre-existing database schema error involving the `email` column is resolved).*
5. `![Load Test Result](./images/load-test.png)`: Terminal output showing the CLI load test results (e.g. `node src/concurrentRunner.js`).
