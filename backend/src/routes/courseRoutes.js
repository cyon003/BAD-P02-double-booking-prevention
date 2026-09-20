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

module.exports = router;
