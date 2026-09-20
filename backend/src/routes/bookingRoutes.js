const express = require("express");

const pool = require("../config/database");
const { sendError } = require("../utils/httpResponses");
const {
  acquireLock,
  releaseLock,
} = require("../services/redisLock");

const router = express.Router();
const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

function parseUnsafeDelayMs() {
  const rawDelay = process.env.UNSAFE_BOOKING_DELAY_MS ?? "0";

  if (!/^\d+$/.test(rawDelay)) {
    return null;
  }

  const delayMs = Number(rawDelay);

  return Number.isSafeInteger(delayMs) ? delayMs : null;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

router.post("/unsafe", async (req, res) => {
  const environment = process.env.NODE_ENV || "development";

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return sendError(
      res,
      403,
      "UNSAFE_BOOKING_FORBIDDEN",
      "Unsafe booking is only available in development or test environments"
    );
  }

  const { studentId, courseId } = req.body || {};

  if (
    !Number.isSafeInteger(studentId) ||
    studentId <= 0 ||
    !Number.isSafeInteger(courseId) ||
    courseId <= 0
  ) {
    return sendError(
      res,
      400,
      "INVALID_BOOKING_INPUT",
      "studentId and courseId must be positive integers"
    );
  }

  const delayMs = parseUnsafeDelayMs();

  if (delayMs === null) {
    return sendError(
      res,
      500,
      "UNSAFE_BOOKING_DELAY_INVALID",
      "UNSAFE_BOOKING_DELAY_MS must be a non-negative integer"
    );
  }

  let client;

  try {
    client = await pool.connect();

    const courseResult = await client.query(
      `
      SELECT id, course_code, capacity, available_seats
      FROM courses
      WHERE id = $1
      `,
      [courseId]
    );

    if (courseResult.rowCount === 0) {
      return sendError(res, 404, "COURSE_NOT_FOUND", "Course not found");
    }

    const studentResult = await client.query(
      `
      SELECT id
      FROM students
      WHERE id = $1
      `,
      [studentId]
    );

    if (studentResult.rowCount === 0) {
      return sendError(res, 404, "STUDENT_NOT_FOUND", "Student not found");
    }

    const course = courseResult.rows[0];
    const bookingCountResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM bookings
      WHERE course_id = $1
        AND UPPER(status) = 'CONFIRMED'
      `,
      [courseId]
    );
    const observedBookingCount = bookingCountResult.rows[0].count;

    if (observedBookingCount >= course.capacity) {
      return sendError(res, 409, "COURSE_FULL", "Course is full");
    }

    // This delay intentionally widens the race window between the capacity
    // check and insert. The endpoint must not acquire the Redis lock.
    await wait(delayMs);

    const bookingResult = await client.query(
      `
      INSERT INTO bookings (student_id, course_id, status)
      VALUES ($1, $2, 'confirmed')
      RETURNING *
      `,
      [studentId, courseId]
    );

    await client.query(
      `
      UPDATE courses
      SET available_seats = GREATEST(
        capacity - (
          SELECT COUNT(*)
          FROM bookings
          WHERE course_id = $1
            AND UPPER(status) = 'CONFIRMED'
        ),
        0
      )
      WHERE id = $1
      `,
      [courseId]
    );

    return res.status(201).json({
      message: "Booking successful",
      unsafe: true,
      observedBookingCount,
      capacity: course.capacity,
      booking: bookingResult.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return sendError(
        res,
        409,
        "BOOKING_ALREADY_EXISTS",
        "Student already has a booking for this course"
      );
    }

    console.error("Unsafe booking failed:", error);

    return sendError(
      res,
      500,
      "UNSAFE_BOOKING_FAILED",
      "Failed to create booking"
    );
  } finally {
    if (client) {
      client.release();
    }
  }
});

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

router.post("/safe", async (req, res) => {
  const { studentId, courseId } = req.body || {};

  if (
    !Number.isSafeInteger(studentId) ||
    studentId <= 0 ||
    !Number.isSafeInteger(courseId) ||
    courseId <= 0
  ) {
    return sendError(
      res,
      400,
      "INVALID_BOOKING_INPUT",
      "studentId and courseId must be positive integers"
    );
  }

  // 2. Create one lock for this course
  const lockKey = `booking:course:${courseId}`;
  let lockToken = null;
  let client = null;
  let transactionStarted = false;

  try {
    // 3. Try to acquire Redis lock
    lockToken = await acquireLock(lockKey);

    if (!lockToken) {
      return res.status(409).json({
        error: "Booking is currently being processed. Please try again.",
      });
    }

    // 4. Get a dedicated Neon/PostgreSQL connection
    client = await pool.connect();

    // 5. Start a transaction before reading or changing protected state.
    await client.query("BEGIN");
    transactionStarted = true;

    // 6. Validate the student before claiming capacity.
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

      return sendError(res, 404, "STUDENT_NOT_FOUND", "Student not found");
    }

    // 7. Claim one seat atomically. This remains safe if Redis is unavailable
    // or multiple application instances execute this statement concurrently.
    const courseClaimResult = await client.query(
      `
      UPDATE courses
      SET available_seats = available_seats - 1
      WHERE id = $1
        AND available_seats > 0
      RETURNING *
      `,
      [courseId]
    );

    if (courseClaimResult.rowCount === 0) {
      const courseResult = await client.query(
        `
        SELECT id
        FROM courses
        WHERE id = $1
        `,
        [courseId]
      );
      await client.query("ROLLBACK");
      transactionStarted = false;

      if (courseResult.rowCount === 0) {
        return sendError(res, 404, "COURSE_NOT_FOUND", "Course not found");
      }

      return sendError(res, 409, "COURSE_FULL", "Course is full");
    }

    const course = courseClaimResult.rows[0];

    // 8. Insert only after the atomic capacity claim succeeds.
    const bookingResult = await client.query(
      `
      INSERT INTO bookings (student_id, course_id, status)
      VALUES ($1, $2, 'confirmed')
      RETURNING *
      `,
      [studentId, courseId]
    );

    // 9. Commit the seat claim and booking together.
    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Booking successful",
      course,
      booking: bookingResult.rows[0],
    });

  } catch (error) {
    // Undo both the seat claim and booking if either operation failed.
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    if (error.code === "23505") {
      return sendError(
        res,
        409,
        "BOOKING_ALREADY_EXISTS",
        "Student already has a booking for this course"
      );
    }

    if (error.code === "23514") {
      return sendError(
        res,
        409,
        "BOOKING_CAPACITY_CONSTRAINT",
        "Booking would violate the course capacity constraints"
      );
    }

    if (error.code === "23503") {
      return sendError(
        res,
        409,
        "BOOKING_REFERENCE_INVALID",
        "Booking references a record that does not exist"
      );
    }

    console.error("Safe booking failed:", error);

    return sendError(
      res,
      500,
      "SAFE_BOOKING_FAILED",
      "Failed to create booking"
    );

  } finally {
    // Return PostgreSQL connection
    if (client) {
      client.release();
    }

    // ALWAYS attempt to release Redis lock
    if (lockToken) {
      try {
        await releaseLock(lockKey, lockToken);
      } catch (releaseError) {
        console.error("Failed to release booking lock:", releaseError);
      }
    }
  }
});

module.exports = router;
