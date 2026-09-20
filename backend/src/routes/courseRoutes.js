const express = require("express");

const pool = require("../config/database");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, course_code, course_name, capacity, available_seats
      FROM courses
      ORDER BY id
      `
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch courses:", error);

    return res.status(500).json({
      error: "Failed to fetch courses",
    });
  }
});

router.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return res.status(400).json({
      error: "courseId must be a positive integer",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, course_code, course_name, capacity, available_seats
      FROM courses
      WHERE id = $1
      `,
      [courseId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Course not found",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch course:", error);

    return res.status(500).json({
      error: "Failed to fetch course",
    });
  }
});

module.exports = router;
