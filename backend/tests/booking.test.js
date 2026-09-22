const request = require("supertest");

jest.mock("pg", () => {
  const actualPg = jest.requireActual("pg");
  return {
    ...actualPg,
    Pool: class Pool extends actualPg.Pool {
      constructor(config) {
        if (config && config.ssl) {
          delete config.ssl;
        }
        super(config);
      }
    }
  };
});

const app = require("../src/server");
const pool = require("../src/config/database");
const redisClient = require("../src/config/redis");

describe("Issue #10 Automated Tests", () => {
  const EXPERIMENT_COURSE_ID = 1;
  process.env.EXPERIMENT_COURSE_ID = EXPERIMENT_COURSE_ID;
  process.env.NODE_ENV = "test";

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    // Ensure capacity is 1
    await pool.query("UPDATE courses SET capacity = 1, available_seats = 1 WHERE id = $1", [EXPERIMENT_COURSE_ID]);
  });

  afterAll(async () => {
    await pool.end();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  async function resetExperiment() {
    const res = await request(app).post("/api/test/reset");
    expect(res.status).toBe(200);
    return res.body;
  }

  const getUniqueIdempotencyKey = () => `test-key-${Date.now()}-${Math.random()}`;

  describe("Experiment reset regression", () => {
    it("seeds all 15 distinct demo students and returns a fresh run namespace", async () => {
      const first = await resetExperiment();
      const second = await resetExperiment();
      expect(second.runId).not.toBe(first.runId);
      expect(second.studentIds).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      const students = await pool.query("SELECT id FROM students WHERE id BETWEEN 1 AND 15 ORDER BY id");
      expect(students.rows.map(row => row.id)).toEqual(second.studentIds);
      const response = await request(app).post("/api/bookings/safe")
        .set("Idempotency-Key", `${second.runId}:3`)
        .send({ studentId: 3, courseId: EXPERIMENT_COURSE_ID });
      expect(response.status).toBe(201);
    });

    it("does not remove an active booking lock during reset", async () => {
      const key = `booking:course:${EXPERIMENT_COURSE_ID}`;
      await redisClient.set(key, "reset-test-owner", { EX: 10 });
      try {
        const response = await request(app).post("/api/test/reset");
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("BOOKING_IN_PROGRESS");
        expect(await redisClient.get(key)).toBe("reset-test-owner");
      } finally {
        await redisClient.del(key);
      }
    });
  });

  describe("TEST 1 - Successful booking", () => {
    it("should successfully book a course and update the database", async () => {
      await resetExperiment();

      const studentId = 1;
      const idempotencyKey = getUniqueIdempotencyKey();

      const res = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", idempotencyKey)
        .send({ studentId, courseId: EXPERIMENT_COURSE_ID });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Booking successful");

      const dbRes = await pool.query(
        "SELECT * FROM bookings WHERE student_id = $1 AND course_id = $2",
        [studentId, EXPERIMENT_COURSE_ID]
      );
      expect(dbRes.rowCount).toBe(1);
    });
  });

  describe("TEST 2 - Full course", () => {
    it("should reject booking when course is full", async () => {
      await resetExperiment();

      // Course capacity is 1. Fill it.
      await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: 1, courseId: EXPERIMENT_COURSE_ID });

      // Try booking again with another student
      const res = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: 2, courseId: EXPERIMENT_COURSE_ID });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("COURSE_FULL");

      const dbRes = await pool.query(
        "SELECT COUNT(*) as count FROM bookings WHERE course_id = $1",
        [EXPERIMENT_COURSE_ID]
      );
      expect(parseInt(dbRes.rows[0].count)).toBe(1);
    });
  });

  describe("TEST 3 - Invalid data", () => {
    it("should reject invalid booking input", async () => {
      const res = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: -1, courseId: EXPERIMENT_COURSE_ID });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_BOOKING_INPUT");
    });
  });

  describe("TEST 4 - Duplicate booking", () => {
    it("should reject the same student booking the same course again", async () => {
      await resetExperiment();
      
      // Increase capacity to 2 so the duplicate hits the unique constraint, not COURSE_FULL
      await pool.query("UPDATE courses SET capacity = 2, available_seats = 2 WHERE id = $1", [EXPERIMENT_COURSE_ID]);

      const studentA = 1;
      const studentB = 2;

      // 1. Student A books successfully
      await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: studentA, courseId: EXPERIMENT_COURSE_ID });

      // 2. Student A books again (duplicate)
      const resDuplicate = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: studentA, courseId: EXPERIMENT_COURSE_ID });

      expect(resDuplicate.status).toBe(409);
      expect(resDuplicate.body.error.code).toBe("BOOKING_ALREADY_EXISTS");
      
      // 3. Student B books successfully
      const resStudentB = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: studentB, courseId: EXPERIMENT_COURSE_ID });

      expect(resStudentB.status).toBe(201);
      
      // Verify database
      const dbRes = await pool.query(
        "SELECT * FROM bookings WHERE course_id = $1",
        [EXPERIMENT_COURSE_ID]
      );
      
      const studentABookings = dbRes.rows.filter(r => r.student_id === studentA);
      expect(studentABookings.length).toBe(1);
      expect(dbRes.rowCount).toBe(2);
    });
  });

  describe("TEST 5 - Redis locking", () => {
    it("should reject if Redis lock cannot be acquired", async () => {
      await resetExperiment();
      const lockKey = `booking:course:${EXPERIMENT_COURSE_ID}`;
      
      await redisClient.set(lockKey, "test-lock-token", { EX: 10 });

      const res = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: 1, courseId: EXPERIMENT_COURSE_ID });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("BOOKING_IN_PROGRESS");

      await redisClient.del(lockKey);
    });
  });

  describe("TEST 6 - Transaction rollback", () => {
    it("should rollback transaction when student does not exist", async () => {
      await resetExperiment();
      
      const courseRes = await pool.query("SELECT available_seats FROM courses WHERE id = $1", [EXPERIMENT_COURSE_ID]);
      const seatsBefore = courseRes.rows[0].available_seats;

      const res = await request(app)
        .post("/api/bookings/safe")
        .set("Idempotency-Key", getUniqueIdempotencyKey())
        .send({ studentId: 999, courseId: EXPERIMENT_COURSE_ID });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STUDENT_NOT_FOUND");

      const courseResAfter = await pool.query("SELECT available_seats FROM courses WHERE id = $1", [EXPERIMENT_COURSE_ID]);
      const seatsAfter = courseResAfter.rows[0].available_seats;
      expect(seatsAfter).toBe(seatsBefore); 
    });
  });

  describe("TEST 7 - Concurrent bookings", () => {
    it("should prevent double booking when multiple concurrent requests are made", async () => {
      await resetExperiment();
      
      const concurrentRequests = 2; // We have students 1 and 2
      const promises = [];

      for (let i = 1; i <= concurrentRequests; i++) {
        promises.push(
          request(app)
            .post("/api/bookings/safe")
            .set("Idempotency-Key", getUniqueIdempotencyKey())
            .send({ studentId: i, courseId: EXPERIMENT_COURSE_ID })
        );
      }

      const results = await Promise.all(promises);
      
      const successful = results.filter(r => r.status === 201);
      const failed = results.filter(r => r.status === 409);

      // Verify exactly 1 booking succeeded (capacity = 1)
      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].body.error.code).toBe("BOOKING_IN_PROGRESS");

      const dbRes = await pool.query(
        "SELECT COUNT(*) as count FROM bookings WHERE course_id = $1",
        [EXPERIMENT_COURSE_ID]
      );
      expect(parseInt(dbRes.rows[0].count)).toBe(1);
    });
  });
});
