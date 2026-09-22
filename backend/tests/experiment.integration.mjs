// Run against the development server: node --test tests/experiment.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { resetExperiment, sendBooking, requestJson, requireSuccess, summarizeResponses, verificationStatus } from '../../frontend/src/experiment.js';
dotenv.config({ quiet: true });
const { default: pool } = await import('../src/config/database.js');

test('dashboard: reset / unsafe / reset / safe, twice, with real database verification', async () => {
  const courseId = Number(process.env.EXPERIMENT_COURSE_ID);
  const original = (await pool.query('SELECT capacity FROM courses WHERE id = $1', [courseId])).rows[0];
  const runIds = new Set();
  try {
    await resetExperiment();
    await pool.query('UPDATE courses SET capacity = 2, available_seats = 2 WHERE id = $1', [courseId]);
    for (const isSafe of [false, true, false, true]) {
      const reset = await resetExperiment();
      assert.equal(reset.course.id, courseId);
      assert.equal(reset.course.available_seats, 2);
      assert.equal(reset.bookingCount, 0);
      assert.deepEqual(reset.studentIds, Array.from({ length: 15 }, (_, i) => i + 1));
      assert.ok(!runIds.has(reset.runId));
      runIds.add(reset.runId);
      const clean = requireSuccess(await requestJson(`/test/results?courseId=${courseId}`));
      assert.equal(clean.results.confirmed_bookings, 0);
      const responses = await Promise.all(reset.studentIds.slice(0, 12).map(id => sendBooking(isSafe, id, courseId, reset.runId)));
      const snapshot = requireSuccess(await requestJson(`/test/results?courseId=${courseId}`));
      const db = (await pool.query(`SELECT capacity, available_seats,
        (SELECT COUNT(*)::int FROM bookings WHERE course_id = $1 AND UPPER(status) = 'CONFIRMED') AS count
        FROM courses WHERE id = $1`, [courseId])).rows[0];
      const successes = responses.filter(r => r.status === 201).length;
      assert.equal(snapshot.results.confirmed_bookings, db.count);
      assert.equal(snapshot.course.available_seats, db.available_seats);
      assert.equal(successes, db.count);
      assert.equal(snapshot.results.double_booking_detected, db.count > db.capacity);
      assert.equal(snapshot.results.seat_count_consistent, db.available_seats === db.capacity - db.count);
      assert.ok(responses.every(r => r.status === 201 || (r.status === 409 && r.body.error.code === 'COURSE_FULL')));
      const status = verificationStatus({ course: snapshot.course, results: snapshot.results, responses,
        mode: isSafe ? 'safe' : 'unsafe', requestCount: 12, error: '' });
      assert.equal(status, isSafe ? 'SAFE' : db.count > db.capacity || !snapshot.results.seat_count_consistent ? 'DETECTED' : 'INCONCLUSIVE');
      if (isSafe) {
        assert.equal(successes, 2);
        assert.equal(db.available_seats, 0);
        assert.equal(snapshot.results.double_booking_detected, false);
        const winner = responses.find(r => r.status === 201);
        const replay = await sendBooking(true, winner.body.booking.student_id, courseId, reset.runId);
        assert.equal(replay.body.booking.id, winner.body.booking.id);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM bookings WHERE course_id = $1', [courseId])).rows[0].count, 2);
      } else {
        assert.ok(successes > 0);
      }
      console.log(JSON.stringify({ mode: isSafe ? 'safe' : 'unsafe', status, responses: summarizeResponses(responses), attempts: responses.reduce((n, r) => n + r.attempts.length, 0), db, overbooked: snapshot.results.double_booking_detected }));
    }
  } finally {
    await resetExperiment();
    await pool.query('UPDATE courses SET capacity = $2, available_seats = $2 WHERE id = $1', [courseId, original.capacity]);
    await pool.end();
  }
});
