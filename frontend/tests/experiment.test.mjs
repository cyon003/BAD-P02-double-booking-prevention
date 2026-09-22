import test from 'node:test'
import assert from 'node:assert/strict'
import { sendBooking, resetExperiment, summarizeResponses, requestWithContentionRetry, verificationStatus } from '../src/experiment.js'

const response = (status, body) => new Response(JSON.stringify(body), { status })

test('retries lock contention with the same key; preserves status, body and every attempt', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1
      ? response(409, { error: { code: 'BOOKING_IN_PROGRESS', message: 'Retry' } })
      : response(201, { booking: { id: 123 } })
  })
  const result = await sendBooking(true, 3, 1, 'run-one')
  assert.equal(result.status, 201)
  assert.equal(result.body.booking.id, 123)
  assert.deepEqual(result.attempts.map(r => r.status), [409, 201])
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'run-one:3')
  assert.deepEqual(calls[0], calls[1])
})

test('does not retry invalid students, full courses, duplicates or server errors', async t => {
  for (const [status, code] of [[404, 'STUDENT_NOT_FOUND'], [409, 'COURSE_FULL'], [409, 'BOOKING_ALREADY_EXISTS'], [500, 'SAFE_BOOKING_FAILED']]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response(status, { error: { code } }))
    const result = await sendBooking(true, 1, 1, 'run-two')
    assert.equal(result.attempts.length, 1)
    assert.deepEqual(summarizeResponses([result]), [[`${status} ${code}`, 1]])
    mock.mock.restore()
  }
})

test('failed reset is surfaced and cannot start an experiment', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(500, { error: 'Reset failed' }))
  await assert.rejects(resetExperiment, /500:.*Reset failed/)
})

test('network failures remain visible and lock retry deadline terminates', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline') })
  const result = await sendBooking(false, 1, 1, 'run-three')
  assert.equal(result.status, 'NETWORK')
  assert.equal(result.body.error.message, 'Offline')
  mock.mock.restore()
  t.mock.method(globalThis, 'fetch', async () => response(409, { error: { code: 'BOOKING_IN_PROGRESS' } }))
  const timedOut = await requestWithContentionRetry('/bookings/safe', {}, 0)
  assert.equal(timedOut.attempts.length, 1)
  assert.equal(timedOut.status, 409)
})


test('zero bookings and failed requests are inconclusive, while verified safe and unsafe states differ', () => {
  const state = {
    course: { capacity: 2, available_seats: 2 },
    results: { confirmed_bookings: 0, double_booking_detected: false, seat_count_consistent: true },
    responses: Array.from({ length: 12 }, () => ({ status: 409, body: { error: { code: 'BOOKING_IN_PROGRESS' } } })),
    mode: 'safe', requestCount: 12, error: '',
  }
  assert.equal(verificationStatus(state), 'INCONCLUSIVE')
  state.course.available_seats = 0
  state.results.confirmed_bookings = 2
  state.responses = Array.from({ length: 12 }, (_, i) => i < 2
    ? { status: 201, body: {} }
    : { status: 409, body: { error: { code: 'COURSE_FULL' } } })
  assert.equal(verificationStatus(state), 'SAFE')
  assert.equal(verificationStatus({ ...state, mode: 'unsafe' }), 'INCONCLUSIVE')
  state.results.confirmed_bookings = 10
  state.results.double_booking_detected = true
  state.results.seat_count_consistent = false
  assert.equal(verificationStatus({ ...state, mode: 'unsafe' }), 'DETECTED')
  assert.equal(verificationStatus({ ...state, error: 'Verification failed' }), 'INCONCLUSIVE')
})
