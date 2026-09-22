const express = require("express");
const { randomUUID } = require("crypto");

const pool = require("../config/database");
const { sendError } = require("../utils/httpResponses");
const { parsePositiveInteger } = require("../utils/validation");
const { acquireLock, releaseLock } = require("../services/redisLock");

const router = express.Router();
const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

function getExperimentCourseId() {
  const rawCourseId = process.env.EXPERIMENT_COURSE_ID;

  if (!rawCourseId || !/^\d+$/.test(rawCourseId)) {
    return null;
  }

  const courseId = Number(rawCourseId);

  return Number.isSafeInteger(courseId) && courseId > 0 ? courseId : null;
}

// Reset experiment
router.post("/reset", async (req, res) => {
  const environment = process.env.NODE_ENV || "development";

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return res.status(403).json({
      error:
        "Experiment reset is only available in development or test environments",
    });
  }

  const experimentCourseId = getExperimentCourseId();

  if (!experimentCourseId) {
    return res.status(500).json({
      error: "EXPERIMENT_COURSE_ID must be configured as a positive integer",
    });
  }

  let client;
  let lockToken;
  const lockKey = `booking:course:${experimentCourseId}`;

  try {
    // Never delete another request's live lock to make a reset succeed.
    lockToken = await acquireLock(lockKey);
    if (!lockToken) {
      return sendError(res, 409, "BOOKING_IN_PROGRESS", "Wait for the active booking before resetting");
    }
    client = await pool.connect();
    await client.query("BEGIN");

    const courseResult = await client.query(
      `
      SELECT id, course_code, capacity, available_seats
      FROM courses
      WHERE id = $1
      FOR UPDATE
      `,
      [experimentCourseId]
    );

    if (courseResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Experiment course not found",
        courseId: experimentCourseId,
      });
    }

    const deletedBookingsResult = await client.query(
      `
      DELETE FROM bookings
      WHERE course_id = $1
      RETURNING id
      `,
      [experimentCourseId]
    );

    // The demo sends distinct students 1–15. Preserve existing student data.
    await client.query(`
      INSERT INTO students (id, name)
      SELECT id, 'Demo Student ' || id
      FROM generate_series(1, 15) AS id
      ON CONFLICT (id) DO NOTHING
    `);
    // Explicit seed IDs must not collide with future generated IDs.
    await client.query(`
      SELECT setval(pg_get_serial_sequence('students', 'id'),
        GREATEST((SELECT MAX(id) FROM students),
          nextval(pg_get_serial_sequence('students', 'id'))))
    `);

    const resetCourseResult = await client.query(
      `
      UPDATE courses
      SET available_seats = capacity
      WHERE id = $1
      RETURNING id, course_code, capacity, available_seats
      `,
      [experimentCourseId]
    );

    await client.query("COMMIT");

    await releaseLock(lockKey, lockToken);
    lockToken = null;

    return res.json({
      message: "Experiment reset successfully",
      course: resetCourseResult.rows[0],
      bookingCount: 0,
      deletedBookingCount: deletedBookingsResult.rowCount,
      studentIds: Array.from({ length: 15 }, (_, i) => i + 1),
      // A fresh namespace prevents replaying cached results from an older run.
      runId: randomUUID(),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Experiment reset rollback failed:", rollbackError);
      }
    }

    console.error("Experiment reset failed:", error);

    return res.status(500).json({
      error: "Failed to reset experiment",
    });
  } finally {
    if (client) {
      client.release();
    }
    if (lockToken) {
      await releaseLock(lockKey, lockToken).catch((error) => {
        console.error("Failed to release experiment lock:", error);
      });
    }
  }
});

// Get experiment results
router.get("/results", async (req, res) => {
  const rawCourseId = req.query.courseId ?? process.env.EXPERIMENT_COURSE_ID;
  const courseId = parsePositiveInteger(rawCourseId);

  if (courseId === null) {
    const status = req.query.courseId === undefined ? 500 : 400;

    return sendError(
      res,
      status,
      status === 500
        ? "EXPERIMENT_COURSE_NOT_CONFIGURED"
        : "INVALID_COURSE_ID",
      status === 500
        ? "EXPERIMENT_COURSE_ID is not configured"
        : "courseId must be a positive integer"
    );
  }

  try {
    const result = await pool.query(
      `
      SELECT
        courses.id,
        courses.course_code,
        courses.capacity,
        courses.available_seats,
        COUNT(bookings.id) FILTER (
          WHERE UPPER(bookings.status) = 'CONFIRMED'
        )::int AS confirmed_bookings
      FROM courses
      LEFT JOIN bookings ON bookings.course_id = courses.id
      WHERE courses.id = $1
      GROUP BY courses.id
      `,
      [courseId]
    );

    if (result.rowCount === 0) {
      return sendError(
        res,
        404,
        "EXPERIMENT_COURSE_NOT_FOUND",
        "Experiment course not found"
      );
    }

    const course = result.rows[0];

    return res.json({
      course: {
        id: course.id,
        course_code: course.course_code,
        capacity: course.capacity,
        available_seats: course.available_seats,
      },
      results: {
        confirmed_bookings: course.confirmed_bookings,
        double_booking_detected:
          course.confirmed_bookings > course.capacity,
        seat_count_consistent:
          course.available_seats === course.capacity - course.confirmed_bookings,
      },
    });
  } catch (error) {
    console.error("Failed to fetch test results:", error);

    return sendError(
      res,
      500,
      "TEST_RESULTS_FETCH_FAILED",
      "Failed to fetch test results"
    );
  }
});

module.exports = router;
