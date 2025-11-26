import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [backendStatus, setBackendStatus] = useState('Checking...')
  const [error, setError] = useState(null)
  const [elevators, setElevators] = useState([])
  const [formData, setFormData] = useState({
    elevator: '',
    door: 'CLOSED',
    person: 0,
    sensors: '{}',
    hallcall: '{}',
    carcall: '{}'
  })
  const [editingId, setEditingId] = useState(null)

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

    // Load elevator configurations
    loadElevators()
  }, [])

  const loadElevators = () => {
    axios.get('/api/elevator-conf')
      .then(response => {
        setElevators(response.data)
      })
      .catch(err => {
        console.error('Failed to load elevators:', err)
      })
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'person' ? parseInt(value) || 0 : value
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editingId) {
      // Update existing
      axios.put(`/api/elevator-conf/${editingId}`, formData)
        .then(() => {
          loadElevators()
          resetForm()
        })
        .catch(err => console.error('Failed to update:', err))
    } else {
      // Create new
      axios.post('/api/elevator-conf', formData)
        .then(() => {
          loadElevators()
          resetForm()
        })
        .catch(err => console.error('Failed to create:', err))
    }
  }

  const handleEdit = (elevator) => {
    setFormData({
      elevator: elevator.elevator,
      door: elevator.door,
      person: elevator.person,
      sensors: elevator.sensors || '{}',
      hallcall: elevator.hallcall || '{}',
      carcall: elevator.carcall || '{}'
    })
    setEditingId(elevator.id)
  }

  const handleDelete = (id) => {
    if (window.confirm('Delete this elevator configuration?')) {
      axios.delete(`/api/elevator-conf/${id}`)
        .then(() => loadElevators())
        .catch(err => console.error('Failed to delete:', err))
    }
  }

  const resetForm = () => {
    setFormData({
      elevator: '',
      door: 'CLOSED',
      person: 0,
      sensors: '{}',
      hallcall: '{}',
      carcall: '{}'
    })
    setEditingId(null)
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>CPS Elevator System</h1>
        <div className="status-container">
          <h2>System Status</h2>
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <p className="success">{backendStatus}</p>
          )}
        </div>
      </header>

      <div className="elevator-section">
        <h2>Elevator Configuration</h2>

        <form className="elevator-form" onSubmit={handleSubmit}>
          <h3>{editingId ? 'Edit Elevator' : 'Add New Elevator'}</h3>
          <div className="form-group">
            <label>Elevator ID:</label>
            <input
              type="text"
              name="elevator"
              value={formData.elevator}
              onChange={handleInputChange}
              required
              placeholder="e.g., ELEVATOR-01"
            />
          </div>
          <div className="form-group">
            <label>Door Status:</label>
            <select name="door" value={formData.door} onChange={handleInputChange}>
              <option value="OPEN">OPEN</option>
              <option value="CLOSED">CLOSED</option>
              <option value="OPENING">OPENING</option>
              <option value="CLOSING">CLOSING</option>
            </select>
          </div>
          <div className="form-group">
            <label>Person Count:</label>
            <input
              type="number"
              name="person"
              value={formData.person}
              onChange={handleInputChange}
              min="0"
            />
          </div>
          <div className="form-group">
            <label>Sensors (JSON):</label>
            <textarea
              name="sensors"
              value={formData.sensors}
              onChange={handleInputChange}
              placeholder='{"floor": 1, "weight": 150}'
            />
          </div>
          <div className="form-group">
            <label>Hall Call (JSON):</label>
            <textarea
              name="hallcall"
              value={formData.hallcall}
              onChange={handleInputChange}
              placeholder='{"up": [2, 5], "down": [8]}'
            />
          </div>
          <div className="form-group">
            <label>Car Call (JSON):</label>
            <textarea
              name="carcall"
              value={formData.carcall}
              onChange={handleInputChange}
              placeholder='{"floors": [3, 7, 10]}'
            />
          </div>
          <div className="form-actions">
            <button type="submit">{editingId ? 'Update' : 'Create'}</button>
            {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>

        <div className="elevator-list">
          <h3>Active Elevators ({elevators.length})</h3>
          {elevators.length === 0 ? (
            <p className="no-data">No elevator configurations found</p>
          ) : (
            <div className="elevator-cards">
              {elevators.map(elevator => (
                <div key={elevator.id} className="elevator-card">
                  <h4>{elevator.elevator}</h4>
                  <p><strong>Door:</strong> {elevator.door}</p>
                  <p><strong>Persons:</strong> {elevator.person}</p>
                  <p><strong>Sensors:</strong> {elevator.sensors}</p>
                  <p><strong>Hall Call:</strong> {elevator.hallcall}</p>
                  <p><strong>Car Call:</strong> {elevator.carcall}</p>
                  <div className="card-actions">
                    <button onClick={() => handleEdit(elevator)}>Edit</button>
                    <button onClick={() => handleDelete(elevator.id)} className="delete-btn">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="info">
        <p>Backend: Spring Boot with PostgreSQL | Frontend: React + Vite | Network: app_cps_net</p>
      </footer>
    </div>
  )
}

export default App
