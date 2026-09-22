import { useState, useEffect } from 'react'
import './App.css'

import { requestJson, requireSuccess, resetExperiment, sendBooking, summarizeResponses, verificationStatus } from './experiment'

function App() {
  const [concurrentCount, setConcurrentCount] = useState(10)
  const [isRunning, setIsRunning] = useState(false)

  const [courseDetails, setCourseDetails] = useState(null)
  const [responses, setResponses] = useState([])
  const [dbResults, setDbResults] = useState(null)
  const [error, setError] = useState('')
  const [testMode, setTestMode] = useState(null)

  useEffect(() => {
    let active = true
    requestJson('/test/results').then(requireSuccess).then(data => {
      if (active) {
        setCourseDetails(data.course)
        setDbResults(data.results)
      }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  const fetchResults = async (courseId) => {
    const data = requireSuccess(await requestJson(`/test/results?courseId=${courseId}`))
    setCourseDetails(data.course)
    setDbResults(data.results)
  }

  const handleReset = async () => {
    setIsRunning(true)
    setError('')
    setDbResults(null)
    setTestMode(null)
    setResponses([])
    try {
      const reset = await resetExperiment()
      await fetchResults(reset.course.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setIsRunning(false)
    }
  }

  const runTest = async (isSafe) => {
    setIsRunning(true)
    setError('')
    setResponses([])
    setDbResults(null)
    setTestMode(isSafe ? 'safe' : 'unsafe')
    try {
      const reset = await resetExperiment()
      if (!reset.runId || !Array.isArray(reset.studentIds) || reset.studentIds.length < concurrentCount) {
        throw new Error('Reset did not return enough demo students and a run ID. Restart the updated backend.')
      }
      setCourseDetails(reset.course)
      const responses = await Promise.all(reset.studentIds.slice(0, concurrentCount).map(studentId =>
        sendBooking(isSafe, studentId, reset.course.id, reset.runId)
      ))
      setResponses(responses)
      await fetchResults(reset.course.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setIsRunning(false)
    }
  }

  const successCount = responses.filter(r => r.status === 201).length
  const status = verificationStatus({
    course: courseDetails, results: dbResults, responses,
    mode: testMode, requestCount: responses.length, error,
  })
  const inconsistent = status === 'DETECTED'
  const verifiedSafe = status === 'SAFE'
  const attempts = responses.flatMap(r => r.attempts)

  return (
    <div className="dashboard-container">
      <header>
        <h1>Booking Comparison Dashboard</h1>
        {courseDetails && (
          <div className="capacity-badge">
            Course Capacity: <span>{courseDetails.capacity}</span>
          </div>
        )}
      </header>

      <div className="controls-panel">
        <div className="input-group">
          <label htmlFor="concurrent-count">Concurrent Requests (Max 15):</label>
          <input
            id="concurrent-count"
            type="number"
            min="1"
            max="15"
            value={concurrentCount}
            onChange={(e) => {
              const val = Math.min(15, Math.max(1, parseInt(e.target.value) || 1));
              setConcurrentCount(val);
            }}
            disabled={isRunning}
          />
        </div>

        <div className="button-group">
          <button
            className="btn btn-danger"
            onClick={() => runTest(false)}
            disabled={isRunning}
          >
            Run Unsafe Test
          </button>
          <button
            className="btn btn-success"
            onClick={() => runTest(true)}
            disabled={isRunning}
          >
            Run Safe Test
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={isRunning}
          >
            Reset
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      {isRunning && <p role="status">Running experiment; retrying lock contention when needed…</p>}
      <div className="results-panel">
        <div className="result-card">
          <h3>HTTP Responses</h3>
          <p>Final responses per request. Contention retries are listed below.</p>
          <div className="stat-row">
            <span className="stat-label">Success (201):</span>
            <span className="stat-value text-success">{successCount}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Failed requests:</span>
            <span className="stat-value text-danger">{responses.length - successCount}</span>
          </div>
          {summarizeResponses(responses).map(([label, count]) => (
            <div className="stat-row" key={label}><span>{label}</span><strong>{count}</strong></div>
          ))}
          {attempts.length > 0 && <details>
            <summary>All HTTP attempts ({attempts.length}, including retries)</summary>
            {summarizeResponses(attempts).map(([label, count]) => <p key={label}>{label}: {count}</p>)}
            <details><summary>Response bodies</summary><pre>{JSON.stringify(responses, null, 2)}</pre></details>
          </details>}
        </div>

        {dbResults && courseDetails && (
          <div className="result-card">
            <h3>Database Verification</h3>
            <div className="stat-row">
              <span className="stat-label">Actual DB Bookings:</span>
              <span className="stat-value">{dbResults.confirmed_bookings}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Remaining Seats:</span>
              <span className="stat-value">{courseDetails.available_seats}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Double Booking Status:</span>
              <span className={`stat-value badge ${inconsistent ? 'badge-danger' : verifiedSafe ? 'badge-success' : 'badge-neutral'}`}>
                {status}
              </span>
            </div>
            {status === 'INCONCLUSIVE' && <p>No inconsistency detected in this run; this does not establish safety. Check response details and retry.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
