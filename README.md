# Double Booking Prevention System

This project demonstrates a real-world scenario of a "double-booking" race condition, alongside a complete, production-ready solution to prevent it. It features a React frontend dashboard and a Node.js/Express backend connected to Redis and PostgreSQL (Neon).

## Project Overview

High-traffic applications (e.g., event ticketing, course registration) often suffer from race conditions when multiple users attempt to book the last remaining seat simultaneously. 

This repository exposes two distinct endpoints for comparison:
1. **Unsafe Endpoint (`/api/bookings/unsafe`)**: A standard "check-then-insert" implementation that is deliberately vulnerable to race conditions.
2. **Safe Endpoint (`/api/bookings/safe`)**: A hardened endpoint utilizing Idempotency, Redis Distributed Locking, and PostgreSQL Transactions to guarantee consistency.

For detailed sequence diagrams and system architecture, please see the [Architecture Documentation](docs/architecture.md).

---

## 1. The Vulnerability (Unsafe Workflow)

### Race Condition Explanation
The unsafe workflow uses a naive "Check-Then-Insert" approach. 
When Client A and Client B request a booking concurrently:
1. Client A queries the database: `SELECT count(*) FROM bookings`. Result: 0 bookings (capacity is 1).
2. Client B queries the database concurrently. Result: 0 bookings.
3. Both clients pass the capacity check in the application logic.
4. Both clients insert a new booking. 
5. The course capacity is exceeded. Double booking occurs.

*Note: The unsafe endpoint in this project intentionally implements an artificial delay (`UNSAFE_BOOKING_DELAY_MS`) to widen this race window for demonstration purposes.*

---

## 2. The Solution (Safe Workflow)

The safe endpoint eliminates double-booking using a multi-layered defense strategy:

### Redis Distributed Lock
Before interacting with the database, the backend attempts to acquire an exclusive lock on the course (`booking:course:${courseId}`) via Redis. 
- Only one request can hold the lock at a time.
- If the lock is held, contenders are immediately rejected with a `409 BOOKING_IN_PROGRESS` error, rather than being queued. 
- This protects the database from connection saturation during traffic spikes.
- The client (e.g., the React frontend) is responsible for implementing jittered retries for these 409 responses.

### Neon / PostgreSQL Database Protection
Even if the Redis lock is bypassed or fails, the database serves as the ultimate source of truth using:
1. **Transactions:** All operations are wrapped in a `BEGIN` and `COMMIT` block.
2. **Atomic Updates:** Seats are claimed using an atomic decrement operation:
   `UPDATE courses SET available_seats = available_seats - 1 WHERE id = $1 AND available_seats > 0 RETURNING *;`
   Since databases lock rows during an `UPDATE`, concurrent transactions are forced to queue sequentially. The `available_seats > 0` condition ensures capacity can never drop below zero.
3. **Unique Constraints:** A unique index on `(student_id, course_id)` prevents the same student from booking multiple times, raising a `23505` constraint violation.

### Idempotency
To prevent accidental duplicate bookings due to network retries, the safe endpoint requires an `Idempotency-Key` header. Redis stores the final result of the initial request. Subsequent retries with the same key safely replay the original response without interacting with the database again.

---

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- PostgreSQL database (e.g., [Neon](https://neon.tech))
- Redis server (e.g., Upstash, local Docker)

### 1. Environment Configuration
Clone the repository and set up the backend environment variables using placeholders (do not commit real secrets).

```sh
cd backend
cp .env.example .env
```

Modify `backend/.env`:
```ini
PORT=5050
NODE_ENV=development
EXPERIMENT_COURSE_ID=1

# Replace with your actual Neon/Postgres connection string
DATABASE_URL="postgresql://user:password@hostname/dbname?sslmode=require"

# Replace with your actual Redis connection string
REDIS_URL="redis://default:password@hostname:port"

UNSAFE_BOOKING_DELAY_MS=100
```

### 2. Start the Backend
```sh
cd backend
npm install
npm run dev
```
*(The backend runs on `http://localhost:5050`)*

### 3. Start the Frontend
```sh
cd frontend
npm install
npm run dev
```
*(The frontend runs on `http://localhost:5173`)*

---

## Running the Experiments

### Resetting the Experiment
Before any test, you must reset the database to a clean state. This clears bookings and generates a new idempotency run ID.
- **Via Frontend:** Click the "Reset Database" button.
- **Via API:** `curl -X POST http://localhost:5050/api/test/reset`

### The Unsafe Experiment
1. Navigate to the React Dashboard.
2. Click "Run Unsafe".
3. The dashboard will fire concurrent requests. 
4. **Expected Result:** You will likely observe more confirmed bookings than the allowed capacity (Double Booking).

### The Safe Experiment
1. Click "Reset Database" to clear the previous run.
2. Click "Run Safe".
3. **Expected Result:** The system guarantees that successful bookings will perfectly match the available capacity. Excess requests will safely be rejected with `409 COURSE_FULL`.

---

## Automated Tests and Load Tests

### 1. Automated Tests (Jest)
The backend features an integration test suite validating constraints, idempotency, and the Redis lock.

```sh
cd backend
npm test -- --runInBand
```

**What it proves:**
- Reset functionality accurately seeds the database (with compatibility fix for missing email column).
- Idempotency successfully prevents duplicate inserts.
- Redis locks reject concurrent requests.
- Transaction rollback occurs properly on invalid students.
- Identical students cannot book the same course (Unique Constraint).
- `COURSE_FULL` is respected.

### 2. CLI Load Tests (concurrentRunner)
A built-in script tests high-concurrency scenarios directly against the API.

```sh
cd backend

# Reset first
curl -X POST http://localhost:5050/api/test/reset

# Run Safe (12 requests, Course 1)
node src/concurrentRunner.js --url http://localhost:5050/api/bookings/safe --requests 12 --course 1
```

### Load Test Results (From Issues #10 & #11)
Real-world load testing using the concurrent CLI runner produced the following results for the safe endpoint:

- **20 requests / 1 seat:** 1 success, 19 conflicts, final bookings: 1. (PASS)
- **50 requests / 5 seats:** 1 success, 49 conflicts, final bookings: 1. (PASS)
  *(Note: Because the lock rejects contenders immediately rather than queuing them, intense concurrent spikes may result in fewer successful bookings than total capacity if clients do not retry adequately. However, capacity is **never** exceeded).*
- **100 requests / 10 seats:** 3 successes, 97 conflicts, final bookings: 3. (PASS)
- **Redis failure simulation:** HTTP 500 error returned. No partial bookings committed. (PASS)
- **Database failure simulation:** HTTP 500 error returned. No partial bookings committed. (PASS)

---

## Interpreting Responses

During safe execution, you may observe the following distinct conflict responses:
- `409 COURSE_FULL`: The database atomic update confirmed no seats remain. The user missed out.
- `409 BOOKING_IN_PROGRESS`: The Redis lock was held by another user. The client should wait (jitter) and retry.

---

## System Limitations

While highly robust, the implementation has deliberate bounds:
1. **Immediate Lock Rejection:** The Redis lock returns `409 BOOKING_IN_PROGRESS` immediately rather than queuing requests on the server. Consequently, the burden of retrying is placed entirely on the client/frontend. Under extreme instantaneous load, this can lead to fewer successful bookings than available capacity if all retries are exhausted simultaneously.
2. **Redis Dependency:** The safe workflow requires Redis to be available. If Redis is down, the system fails closed (500 Internal Server Error) to prevent uncontrolled DB access.
3. **Demo Student Limits:** The tests and dashboard are hardcoded to cycle through student IDs 1 through 15. Attempting to run load tests with more than 15 requests requires configuring the system to allow duplicate bookings per student, or expanding the demo student seed list.
4. **Intentional Vulnerability:** The unsafe endpoint is artificially crippled (via delay) specifically to demonstrate the race condition. It should never be used in a real application.
