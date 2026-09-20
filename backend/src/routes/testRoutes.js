const express = require("express");

const pool = require("../config/database");

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

router.post("/reset", async (req, res) => {
  const environment = process.env.NODE_ENV || "development";

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return res.status(403).json({
      error: "Experiment reset is only available in development or test environments",
    });
  }

  const experimentCourseId = getExperimentCourseId();

  if (!experimentCourseId) {
    return res.status(500).json({
      error: "EXPERIMENT_COURSE_ID must be configured as a positive integer",
    });
  }

  let client;

  try {
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

    return res.json({
      message: "Experiment reset successfully",
      course: resetCourseResult.rows[0],
      bookingCount: 0,
      deletedBookingCount: deletedBookingsResult.rowCount,
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
  }
});

module.exports = router;
