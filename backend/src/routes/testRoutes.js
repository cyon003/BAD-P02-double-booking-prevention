const express = require("express");

const pool = require("../config/database");

const router = express.Router();

router.get("/results", async (req, res) => {
  const rawCourseId = req.query.courseId ?? process.env.EXPERIMENT_COURSE_ID;
  const courseId = Number(rawCourseId);

  if (!Number.isInteger(courseId) || courseId <= 0) {
    const status = req.query.courseId === undefined ? 500 : 400;

    return res.status(status).json({
      error:
        status === 500
          ? "EXPERIMENT_COURSE_ID is not configured"
          : "courseId must be a positive integer",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        courses.id,
        courses.course_code,
        courses.course_name,
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
      return res.status(404).json({
        error: "Experiment course not found",
      });
    }

    const course = result.rows[0];

    return res.json({
      course: {
        id: course.id,
        course_code: course.course_code,
        course_name: course.course_name,
        capacity: course.capacity,
        available_seats: course.available_seats,
      },
      results: {
        confirmed_bookings: course.confirmed_bookings,
        double_booking_detected:
          course.confirmed_bookings > course.capacity,
      },
    });
  } catch (error) {
    console.error("Failed to fetch test results:", error);

    return res.status(500).json({
      error: "Failed to fetch test results",
    });
  }
});

module.exports = router;
