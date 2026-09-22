import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = 'http://localhost:5051/api'

function App() {
  const [concurrentCount, setConcurrentCount] = useState(10)
  const [isRunning, setIsRunning] = useState(false)
  
  // Results state
  const [courseDetails, setCourseDetails] = useState(null)
  const [httpResults, setHttpResults] = useState({ success: 0, fail: 0 })
  const [dbResults, setDbResults] = useState(null)

  // Fetch initial course data on load
  useEffect(() => {
    fetchResults()
  }, [])

  const fetchResults = async () => {
    try {
      const res = await fetch(`${API_BASE}/test/results?courseId=1`)
      if (res.ok) {
        const data = await res.json()
        setCourseDetails(data.course)
        setDbResults(data.results)
      }
    } catch (e) {
      console.error("Failed to fetch results", e)
    }
  }

  const handleReset = async () => {
    setIsRunning(true)
    try {
      await fetch(`${API_BASE}/test/reset`, { method: 'POST' })
      setHttpResults({ success: 0, fail: 0 })
      await fetchResults()
    } catch (e) {
      console.error("Reset failed", e)
    }
    setIsRunning(false)
  }

  const runTest = async (isSafe) => {
    setIsRunning(true)
    setHttpResults({ success: 0, fail: 0 })
    setDbResults(null)
    
    // First reset the experiment
    await fetch(`${API_BASE}/test/reset`, { method: 'POST' })
    
    const requests = []
    
    for (let i = 1; i <= concurrentCount; i++) {
      // Use students 1 through 15 sequentially to avoid BOOKING_ALREADY_EXISTS 
      // unless concurrentCount > 15 (which UI prevents)
      const studentId = (i % 15) || 15;
      
      const headers = { 'Content-Type': 'application/json' }
      if (isSafe) {
        headers['Idempotency-Key'] = crypto.randomUUID()
      }

      const endpoint = isSafe ? '/bookings/safe' : '/bookings/unsafe'
      
      requests.push(
        fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ studentId, courseId: 1 })
        })
      )
    }

    try {
      const responses = await Promise.all(requests)
      const successes = responses.filter(r => r.ok).length
      const failures = responses.length - successes
      
      setHttpResults({ success: successes, fail: failures })
    } catch (e) {
      console.error("Test execution failed", e)
    }

    // Fetch DB results
    await fetchResults()
    setIsRunning(false)
  }

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

      <div className="results-panel">
        <div className="result-card http-results">
          <h3>HTTP Responses</h3>
          <div className="stat-row">
            <span className="stat-label">Success (201):</span>
            <span className="stat-value text-success">{httpResults.success}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Failures (4xx/5xx):</span>
            <span className="stat-value text-danger">{httpResults.fail}</span>
          </div>
        </div>

        {dbResults && courseDetails && (
          <div className="result-card db-results">
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
              <span className={`stat-value badge ${dbResults.double_booking_detected ? 'badge-danger' : 'badge-success'}`}>
                {dbResults.double_booking_detected ? 'DETECTED' : 'SAFE'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
