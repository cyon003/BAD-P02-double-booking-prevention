const express = require("express");

const pool = require("../config/database");
const { sendError } = require("../utils/httpResponses");
const { parsePositiveInteger } = require("../utils/validation");

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

    return sendError(
      res,
      500,
      "COURSES_FETCH_FAILED",
      "Failed to fetch courses"
    );
  }
});

router.get("/:courseId", async (req, res) => {
  const courseId = parsePositiveInteger(req.params.courseId);

  if (courseId === null) {
    return sendError(
      res,
      400,
      "INVALID_COURSE_ID",
      "courseId must be a positive integer"
    );
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
      return sendError(res, 404, "COURSE_NOT_FOUND", "Course not found");
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch course:", error);

    return sendError(
      res,
      500,
      "COURSE_FETCH_FAILED",
      "Failed to fetch course"
    );
  }
});

module.exports = router;
