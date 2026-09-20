# Concurrent Booking Test Runner

This project includes a concurrent request test runner to simulate race conditions and test double-booking prevention mechanisms.

## How to Run

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Run the test script using Node.js:
   ```bash
   node src/concurrentRunner.js [options]
   ```

### Options

You can configure the test runner using command-line arguments:
* `--url <url>` : The target API endpoint (default: `http://localhost:5050/api/bookings/safe`)
* `--requests <number>` : The number of concurrent requests to fire (default: `100`)
* `--course <id>` : The ID of the course to attempt booking (default: `1`)

### Examples

From the `backend` directory, run:

```bash
# Test the safe endpoint (Redis lock protection)
node src/concurrentRunner.js --url http://localhost:5051/api/bookings/safe --requests 20 --course 1

# Test the unsafe endpoint (to demonstrate race conditions)
node src/concurrentRunner.js --url http://localhost:5051/api/bookings/unsafe --requests 20 --course 1
```

### Required Setup Data
To successfully run this test, your database must have:
1. A course with ID `1` (or whatever ID you specify) with `capacity = 1`.
2. Students with ID `1` and `2` (the runner alternates between these two students).
3. Ensure no prior bookings exist for this course before running the test, or the capacity will already be full.
