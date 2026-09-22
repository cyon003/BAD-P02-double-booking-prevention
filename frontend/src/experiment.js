export const API_BASE = 'http://localhost:5051/api'

export async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: { code: 'INVALID_RESPONSE', message: text || 'Empty response' } }
  }
  return { status: response.status, body }
}

export function requireSuccess(response) {
  if (response.status < 200 || response.status >= 300 || response.body.error) {
    const error = response.body.error
    throw new Error(`${response.status}: ${error?.code || ''} ${error?.message || error || 'Request failed'}`)
  }
  return response.body
}

// Retry only explicit lock contention, retaining the same idempotency key.
// Other failures remain visible. A deadline prevents a stuck lock hanging the UI.
export async function requestWithContentionRetry(path, options, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  const attempts = []
  while (true) {
    let response
    try {
      response = await requestJson(path, options)
    } catch (error) {
      response = { status: 'NETWORK', body: { error: { code: 'NETWORK_ERROR', message: error.message } } }
    }
    attempts.push(response)
    if (response.status !== 409 || response.body.error?.code !== 'BOOKING_IN_PROGRESS' || Date.now() >= deadline) {
      return { ...response, attempts }
    }
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200))
  }
}

export async function resetExperiment() {
  return requireSuccess(await requestWithContentionRetry('/test/reset', { method: 'POST' }))
}

export function sendBooking(isSafe, studentId, courseId, runId) {
  const headers = { 'Content-Type': 'application/json' }
  if (isSafe) headers['Idempotency-Key'] = `${runId}:${studentId}`
  return requestWithContentionRetry(`/bookings/${isSafe ? 'safe' : 'unsafe'}`, {
    method: 'POST', headers, body: JSON.stringify({ studentId, courseId }),
  })
}

export function summarizeResponses(responses) {
  const counts = {}
  for (const response of responses) {
    const label = `${response.status} ${response.body.error?.code || (response.status === 201 ? 'Created' : 'Unexpected response')}`
    counts[label] = (counts[label] || 0) + 1
  }
  return Object.entries(counts)
}

export function verificationStatus({ course, results, responses, mode, requestCount, error }) {
  if (!course || !results || error) return 'INCONCLUSIVE'
  if (results.double_booking_detected || results.seat_count_consistent === false) return 'DETECTED'
  if (!mode) return 'READY'
  const expected = Math.min(requestCount, course.capacity)
  const successes = responses.filter(r => r.status === 201 && !r.body.error).length
  const expectedResponses = responses.length === requestCount && responses.every(r =>
    (r.status === 201 && !r.body.error) || (r.status === 409 && r.body.error?.code === 'COURSE_FULL')
  )
  return mode === 'safe' && successes === expected && expectedResponses &&
    results.confirmed_bookings === expected && course.available_seats === course.capacity - expected
    ? 'SAFE' : 'INCONCLUSIVE'
}
