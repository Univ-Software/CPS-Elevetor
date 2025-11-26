import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import './App.css'

function App() {
  const [backendStatus, setBackendStatus] = useState('Checking...')
  const [error, setError] = useState(null)

  const navigate = useNavigate()

  const handleStart = () => {
    navigate('/dashboard')
  }

  useEffect(() => {
    // Check backend health through nginx proxy
    axios.get('/api/health')
      .then(response => {
        setBackendStatus(response.data)
        setError(null)
      })
      .catch(err => {
        setError('Failed to connect to backend')
        console.error('Backend connection error:', err)
      })
  }, [])

  return (
    <div className="App">
      <header className="App-header">
        <h1>CPS(Cyber-Physical System)</h1>
        <div className="status-container">
          <h2>System Status</h2>
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <p className="success">{backendStatus}</p>
          )}
        </div>
        <div className="info">
          <p>Backend: Spring Boot with PostgreSQL</p>
          <p>Frontend: React + Vite</p>
          <p>Network: app_cps_net</p>
        </div>
        <button className="btn" onClick={handleStart}>Start</button>
      </header>
      <footer className='footer'>
        <p>© 2025 CPS Elevator System</p>
      </footer>
    </div>
  )
}

export default App
