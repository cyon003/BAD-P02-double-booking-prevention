const express = require("express");

const pool = require("../config/database");
const { sendError } = require("../utils/httpResponses");

const {
  acquireLock,
  releaseLock,
} = require("../services/redisLock");

const {
  getIdempotencyRecord,
  claimIdempotencyKey,
  storeIdempotencyResult,
  clearIdempotencyKey,
} = require("../services/idempotency");

const router = express.Router();

/*
 * GET /api/bookings
 *
 * Return all bookings.
 */
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        bookings.id,
        bookings.student_id,
        students.name AS student_name,
        bookings.course_id,
        courses.course_code,
        courses.course_name,
        bookings.status,
        bookings.created_at
      FROM bookings
      JOIN students ON students.id = bookings.student_id
      JOIN courses ON courses.id = bookings.course_id
      ORDER BY bookings.created_at DESC, bookings.id DESC
      `
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch bookings:", error);

    return sendError(
      res,
      500,
      "BOOKINGS_FETCH_FAILED",
      "Failed to fetch bookings"
    );
  }
});

/*
 * POST /api/bookings/safe
 *
 * Safe booking endpoint using:
 *
 * 1. Idempotency protection
 * 2. Redis distributed lock
 * 3. PostgreSQL transaction
 */
router.post("/safe", async (req, res) => {
  const { studentId, courseId } = req.body;
  const rawIdempotencyKey = req.get("Idempotency-Key");

  // 1. Validate Request

  if (!rawIdempotencyKey || !rawIdempotencyKey.trim()) {
    return res.status(400).json({
      error: "Idempotency-Key header is required",
    });
  }

  const idempotencyKey = rawIdempotencyKey.trim();

  if (!Number.isInteger(studentId) || !Number.isInteger(courseId)) {
    return res.status(400).json({
      error: "studentId and courseId must be integers",
    });
  }

  // Check idempotency key

  try {
    const existingRecord =
      await getIdempotencyRecord(idempotencyKey);

    // Same request was already successfully completed.
    // Return the original result instead of creating
    // another booking.
    if (existingRecord?.state === "completed") {
      return res
        .status(existingRecord.statusCode)
        .json(existingRecord.response);
    }

    // Another request with this same key is currently running.
    if (existingRecord?.state === "processing") {
      return res.status(409).json({
        error: "This booking request is already being processed",
      });
    }

    // Atomically claim the key.
    const claimed =
      await claimIdempotencyKey(idempotencyKey);

    if (!claimed) {
      return res.status(409).json({
        error: "This booking request is already being processed",
      });
    }
  } catch (error) {
    console.error("Idempotency check failed:", error);

    return res.status(500).json({
      error: "Failed to process idempotency key",
    });
  }

  // ---------------------------------------------------------
  // 3. Prepare Redis course lock
  // ---------------------------------------------------------

  const lockKey = `booking:course:${courseId}`;

  let lockToken = null;
  let client = null;
  let transactionStarted = false;
  let bookingCommitted = false;

  try {
    // 4. Acquire distributed lock

    lockToken = await acquireLock(lockKey);

    if (!lockToken) {
      // The booking itself has not happened, so allow
      // this idempotency key to be retried.
      await clearIdempotencyKey(idempotencyKey);

      return res.status(409).json({
        error: "Booking is currently being processed. Please try again.",
      });
    }

    // 5. Start PostgreSQL transaction

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // 6. Read latest course information

    const courseResult = await client.query(
      `
      SELECT
        id,
        course_code,
        capacity,
        available_seats
      FROM courses
      WHERE id = $1
      `,
      [courseId]
    );

    if (courseResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      await clearIdempotencyKey(idempotencyKey);

      return res.status(404).json({
        error: "Course not found",
      });
    }

    const course = courseResult.rows[0];

    // 7. Count current confirmed bookings

    const bookingCountResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM bookings
      WHERE course_id = $1
        AND status = 'confirmed'
      `,
      [courseId]
    );

    const currentBookings =
      bookingCountResult.rows[0].count;

    // 8. Check course capacity

    if (currentBookings >= course.capacity) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      await clearIdempotencyKey(idempotencyKey);

      return res.status(409).json({
        error: "Course is full",
      });
    }

    // 9. Check that student exists

    const studentResult = await client.query(
      `
      SELECT id
      FROM students
      WHERE id = $1
      `,
      [studentId]
    );

    if (studentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      await clearIdempotencyKey(idempotencyKey);

      return res.status(404).json({
        error: "Student not found",
      });
    }

    // 10. Create booking

    const bookingResult = await client.query(
      `
      INSERT INTO bookings (
        student_id,
        course_id,
        status
      )
      VALUES ($1, $2, 'confirmed')
      RETURNING *
      `,
      [studentId, courseId]
    );

    // 11. Synchronize available seats

    await client.query(
      `
      UPDATE courses
      SET available_seats = capacity - (
        SELECT COUNT(*)
        FROM bookings
        WHERE course_id = $1
          AND status = 'confirmed'
      )
      WHERE id = $1
      `,
      [courseId]
    );

    // 12. Commit booking

    await client.query("COMMIT");

    transactionStarted = false;
    bookingCommitted = true;

    // 13. Prepare successful response

    const responseBody = {
      message: "Booking successful",
      booking: bookingResult.rows[0],
    };

    // 14. Remember result for duplicate requests

    await storeIdempotencyResult(
      idempotencyKey,
      201,
      responseBody
    );

    return res.status(201).json(responseBody);
  } catch (error) {
    
    // 15. Roll back unfinished database transaction

    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Rollback failed:",
          rollbackError
        );
      }
    }

    /*
     * Only clear the idempotency key if the booking was
     * NOT committed.
     *
     * If PostgreSQL committed successfully but storing the
     * completed Redis record failed, clearing the key could
     * allow a retry to create another booking.
     */
    if (!bookingCommitted) {
      try {
        await clearIdempotencyKey(idempotencyKey);
      } catch (clearError) {
        console.error(
          "Failed to clear idempotency key:",
          clearError
        );
      }
    }

    console.error("Safe booking failed:", error);

    return res.status(500).json({
      error: "Failed to create booking",
    });
  } finally {
    
    // 16. Return PostgreSQL connection

    if (client) {
      client.release();
    }

    // 17. Release Redis course lock

    if (lockToken) {
      try {
        await releaseLock(lockKey, lockToken);
      } catch (releaseError) {
        console.error(
          "Failed to release booking lock:",
          releaseError
        );
      }
    }
  }
});

module.exports = router;