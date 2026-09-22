const { performance } = require('perf_hooks');

// Parse command line arguments
const args = process.argv.slice(2);
let targetUrl = "http://localhost:5050/api/bookings/safe";
let concurrentRequests = 100;
let courseId = 1;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    targetUrl = args[i + 1];
    i++;
  } else if (args[i] === '--requests' && args[i + 1]) {
    concurrentRequests = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--course' && args[i + 1]) {
    courseId = parseInt(args[i + 1], 10);
    i++;
  }
}

const crypto = require("crypto");

async function sendBooking(requestNumber) {
  // Deterministically cycle through students 1-15
  const studentId = (requestNumber % 15) + 1;
  const idempotencyKey = crypto.randomUUID();
  const startTime = performance.now();
  
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        studentId,
        courseId,
      }),
    });

    const endTime = performance.now();
    let data = {};
    let rawText = "";
    try {
      rawText = await response.text();
      data = JSON.parse(rawText);
    } catch (e) {
      // not JSON
    }

    return {
      request: requestNumber,
      status: response.status,
      responseTime: endTime - startTime,
      result: data.message || data.error || rawText.substring(0, 50) || 'Unknown',
    };
  } catch (error) {
    const endTime = performance.now();
    return {
      request: requestNumber,
      status: "ERROR",
      responseTime: endTime - startTime,
      result: error.message,
    };
  }
}

async function runTest() {
  console.log("Starting concurrent requests...");
  
  const startTime = performance.now();
  const requests = [];

  for (let i = 1; i <= concurrentRequests; i++) {
    requests.push(sendBooking(i));
  }

  const results = await Promise.all(requests);
  const endTime = performance.now();

  const successfulBookings = results.filter((r) => r.status === 201);
  const failedBookings = results.filter((r) => r.status === 409 || r.status === 400 || r.status === 404);
  const errors = results.filter((r) => r.status === "ERROR" || r.status === 500);

  if (failedBookings.length > 0) {
    console.log("First failed booking result:", failedBookings[0].result, "Status:", failedBookings[0].status);
  }
  if (errors.length > 0) {
    console.log("First error result:", errors[0].result, "Status:", errors[0].status);
  }

  // Calculate average response time
  const totalResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0);
  const avgResponseTime = results.length > 0 ? (totalResponseTime / results.length).toFixed(2) : 0;
  
  // Note: we can't detect double bookings purely from HTTP count without knowing the capacity.
  // The database verification at the end will do the definitive check.
  const doubleBooking = "UNKNOWN (checking DB...)";

  console.log("\nConcurrent Booking Test");
  console.log("-----------------------");
  console.log(`Target: ${targetUrl}`);
  console.log(`Resource: Course ID ${courseId}`);
  console.log(`Concurrent requests: ${concurrentRequests}\n`);
  
  console.log(`Total requests: ${results.length}`);
  console.log(`Successful: ${successfulBookings.length}`);
  console.log(`Failed: ${failedBookings.length}`);
  console.log(`Conflicts: ${results.filter(r => r.status === 409).length}`);
  console.log(`Other errors: ${errors.length}`);
  console.log(`Average response time: ${avgResponseTime} ms`);
  console.log(`Total execution time: ${(endTime - startTime).toFixed(2)} ms`);
  console.log(`Double booking detected (via HTTP): ${doubleBooking}`);

  // Database verification
  let pass = true;
  
  try {
    require("dotenv").config();
    const { Pool } = require("pg");
    if (!process.env.DATABASE_URL) {
      console.log("\nFINAL RESULT: FAIL (DATABASE_URL not set for verification)");
      return;
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
    });

    const courseRes = await pool.query("SELECT capacity FROM courses WHERE id = $1", [courseId]);
    if (courseRes.rowCount === 0) {
      console.log("\nFINAL RESULT: FAIL (Course not found in database)");
      await pool.end();
      return;
    }
    const capacity = courseRes.rows[0].capacity;

    const bookingRes = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE course_id = $1 AND status = 'confirmed'",
      [courseId]
    );
    const dbBookings = parseInt(bookingRes.rows[0].count, 10);

    console.log("\nDatabase Verification");
    console.log("---------------------");
    console.log(`Course Capacity: ${capacity}`);
    console.log(`Actual Bookings in DB: ${dbBookings}`);

    if (dbBookings > capacity) {
      pass = false;
      console.log(`Mismatch: Bookings (${dbBookings}) exceed capacity (${capacity})!`);
    }

    if (pass) {
      console.log("\nFINAL RESULT: PASS");
    } else {
      console.log("\nFINAL RESULT: FAIL");
    }

    await pool.end();
  } catch (error) {
    console.log("\nFINAL RESULT: FAIL (Database verification error: " + error.message + ")");
  }
}

runTest();
