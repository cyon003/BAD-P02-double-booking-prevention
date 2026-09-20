const express = require("express");

const pool = require("../config/database");
const {
  acquireLock,
  releaseLock,
} = require("../services/redisLock");

const router = express.Router();

router.post("/safe", async (req, res) => {
  const { studentId, courseId } = req.body;

  // 1. Validate input
  if (!Number.isInteger(studentId) || !Number.isInteger(courseId)) {
    return res.status(400).json({
      error: "studentId and courseId must be integers",
    });
  }

  // 2. Create one lock for this course
  const lockKey = `booking:course:${courseId}`;
  let lockToken = null;
  let client = null;

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

    // 5. Start database transaction
    await client.query("BEGIN");

    // 6. Read latest course state AFTER acquiring Redis lock
    const courseResult = await client.query(
      `
      SELECT id, course_code, capacity, available_seats
      FROM courses
      WHERE id = $1
      `,
      [courseId]
    );

    if (courseResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Course not found",
      });
    }

    const course = courseResult.rows[0];

    // 7. Count the latest confirmed bookings from Neon
    const bookingCountResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM bookings
      WHERE course_id = $1
        AND status = 'confirmed'
      `,
      [courseId]
    );

    const currentBookings = bookingCountResult.rows[0].count;

    // 8. Check capacity using Neon as source of truth
    if (currentBookings >= course.capacity) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Course is full",
      });
    }

    // 9. Make sure the student exists
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

      return res.status(404).json({
        error: "Student not found",
      });
    }

    // 10. Store the booking
    const bookingResult = await client.query(
      `
      INSERT INTO bookings (student_id, course_id, status)
      VALUES ($1, $2, 'confirmed')
      RETURNING *
      `,
      [studentId, courseId]
    );

    // 11. Keep available_seats synchronized
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

    // 12. Commit both changes
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Booking successful",
      booking: bookingResult.rows[0],
    });

  } catch (error) {
    // Undo uncommitted database changes if something failed
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    console.error("Safe booking failed:", error);

    return res.status(500).json({
      error: "Failed to create booking",
    });

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

// UNSAFE endpoint for testing race conditions
router.post("/unsafe", async (req, res) => {
  const { studentId, courseId } = req.body;

  if (!Number.isInteger(studentId) || !Number.isInteger(courseId)) {
    return res.status(400).json({ error: "studentId and courseId must be integers" });
  }

  let client = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const courseResult = await client.query(
      "SELECT id, course_code, capacity, available_seats FROM courses WHERE id = $1",
      [courseId]
    );

    if (courseResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Course not found" });
    }

    const course = courseResult.rows[0];

    const bookingCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM bookings WHERE course_id = $1 AND status = 'confirmed'",
      [courseId]
    );

    const currentBookings = bookingCountResult.rows[0].count;

    if (currentBookings >= course.capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Course is full" });
    }

    const studentResult = await client.query(
      "SELECT id FROM students WHERE id = $1",
      [studentId]
    );

    if (studentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Student not found" });
    }
    
    // Simulate slight delay to increase race condition probability
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bookingResult = await client.query(
      "INSERT INTO bookings (student_id, course_id, status) VALUES ($1, $2, 'confirmed') RETURNING *",
      [studentId, courseId]
    );

    await client.query(
      "UPDATE courses SET available_seats = capacity - (SELECT COUNT(*) FROM bookings WHERE course_id = $1 AND status = 'confirmed') WHERE id = $1",
      [courseId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Booking successful",
      booking: bookingResult.rows[0],
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }
    console.error("Unsafe booking failed:", error);
    return res.status(500).json({ error: "Failed to create booking" });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;