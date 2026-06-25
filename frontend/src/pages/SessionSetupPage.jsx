import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import axios from 'axios'

export default function SessionSetupPage() {
  const { sessionId } = useParams()
  const [reviewers, setReviewers] = useState([])
  const [selectedReviewers, setSelectedReviewers] = useState([])
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('senior')
  const [sessionConfig, setSessionConfig] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadReviewers()
    loadSessionConfig()
  }, [sessionId])

  async function loadReviewers() {
    try {
      const res = await axios.get('/api/reviewers')
      setReviewers(res.data.reviewers || [])
    } catch (err) {
      console.error('Failed to load reviewers', err)
    }
  }

  async function loadSessionConfig() {
    try {
      const res = await axios.get(`/api/sessions/${sessionId}/config`)
      setSessionConfig(res.data)
    } catch (err) {
      // No config yet = not set up
    }
  }

  async function handleAddReviewer() {
    if (!newName.trim()) return
    setError('')
    try {
      const res = await axios.post('/api/reviewers', { name: newName.trim(), role: newRole })
      setReviewers(prev => [...prev, res.data])
      setNewName('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add reviewer')
    }
  }

  function toggleReviewer(reviewerId) {
    setSelectedReviewers(prev =>
      prev.includes(reviewerId)
        ? prev.filter(id => id !== reviewerId)
        : [...prev, reviewerId]
    )
  }

  async function handleInvite() {
    if (selectedReviewers.length < 2) {
      setError('Select at least 2 reviewers')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await axios.post(`/api/sessions/${sessionId}/invite`, {
        reviewer_ids: selectedReviewers
      })
      setSessionConfig(res.data.config)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to invite reviewers')
    } finally {
      setLoading(false)
    }
  }

  const roleColors = { lead: '#2563eb', senior: '#ea580c', junior: '#6b7280' }

  return (
    <div className="upload-page">
      <div className="upload-card" style={{ maxWidth: 640 }}>
        <h2>Multi-Reviewer Setup</h2>
        <p className="subtitle">Session: {sessionId}</p>

        {error && <div className="error-msg">{error}</div>}

        {/* If session is already configured, show review links */}
        {sessionConfig && sessionConfig.status !== undefined ? (
          <div>
            <div className="progress-msg">
              Session is in <strong>{sessionConfig.status}</strong> mode
              with {sessionConfig.expected_reviewers.length} reviewers assigned.
            </div>

            <h3 style={{ marginTop: 16, marginBottom: 8 }}>Review Links</h3>
            <p className="hint" style={{ marginBottom: 12 }}>Share these links with each reviewer:</p>

            {sessionConfig.expected_reviewers.map(rid => {
              const reviewer = reviewers.find(r => r.reviewer_id === rid)
              const submitted = (sessionConfig.submitted_reviewers || []).includes(rid)
              return (
                <div key={rid} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', marginBottom: 6,
                  background: submitted ? '#f0fdf4' : '#f9fafb',
                  borderRadius: 6, border: `1px solid ${submitted ? '#bbf7d0' : '#e5e7eb'}`
                }}>
                  <span style={{
                    background: roleColors[reviewer?.role] || '#666',
                    color: 'white', padding: '1px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700
                  }}>
                    {reviewer?.role || 'reviewer'}
                  </span>
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {reviewer?.name || rid}
                  </span>
                  {submitted ? (
                    <span style={{ color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>Submitted</span>
                  ) : (
                    <Link
                      to={`/review/${sessionId}?reviewer=${rid}`}
                      style={{ fontSize: '0.8rem', color: '#2563eb' }}
                    >
                      /review/{sessionId}?reviewer={rid}
                    </Link>
                  )}
                </div>
              )
            })}

            {sessionConfig.status === 'ready_for_resolution' && (
              <div style={{ marginTop: 16 }}>
                <Link to={`/consensus/${sessionId}`}>
                  <button className="btn-primary">View Consensus Dashboard</button>
                </Link>
              </div>
            )}

            {sessionConfig.status === 'reviewing' && (
              <p className="hint" style={{ marginTop: 12 }}>
                Waiting for {sessionConfig.expected_reviewers.length - (sessionConfig.submitted_reviewers || []).length} reviewer(s) to submit.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Add new reviewer */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 8 }}>Add Reviewer</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' }}
                  onKeyDown={e => e.key === 'Enter' && handleAddReviewer()}
                />
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' }}
                >
                  <option value="lead">Lead (weight 3)</option>
                  <option value="senior">Senior (weight 2)</option>
                  <option value="junior">Junior (weight 1)</option>
                </select>
                <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleAddReviewer}>
                  Add
                </button>
              </div>
            </div>

            {/* Select reviewers */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 8 }}>Select Reviewers ({selectedReviewers.length} selected)</h3>
              {reviewers.length === 0 ? (
                <p className="hint">No reviewers registered yet. Add some above.</p>
              ) : (
                reviewers.map(r => (
                  <label key={r.reviewer_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', marginBottom: 4,
                    background: selectedReviewers.includes(r.reviewer_id) ? '#eff6ff' : '#f9fafb',
                    borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${selectedReviewers.includes(r.reviewer_id) ? '#bfdbfe' : '#e5e7eb'}`
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedReviewers.includes(r.reviewer_id)}
                      onChange={() => toggleReviewer(r.reviewer_id)}
                    />
                    <span style={{
                      background: roleColors[r.role] || '#666',
                      color: 'white', padding: '1px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700
                    }}>
                      {r.role}
                    </span>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    <span style={{ color: '#888', fontSize: '0.8rem' }}>weight {r.weight}</span>
                  </label>
                ))
              )}
            </div>

            <button
              className="btn-primary"
              onClick={handleInvite}
              disabled={loading || selectedReviewers.length < 2}
            >
              {loading ? 'Setting up...' : `Invite ${selectedReviewers.length} Reviewers`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
