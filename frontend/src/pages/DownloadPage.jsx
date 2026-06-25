import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import axios from 'axios'

export default function DownloadPage() {
  const { sessionId } = useParams()
  const [feedback, setFeedback] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [fbRes, anRes] = await Promise.all([
          axios.get(`/api/feedback/${sessionId}`),
          axios.get(`/api/analysis/${sessionId}`),
        ])
        setFeedback(fbRes.data)
        setAnalysis(anRes.data)
      } catch {
        try {
          const anRes = await axios.get(`/api/analysis/${sessionId}`)
          setAnalysis(anRes.data)
        } catch {}
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [sessionId])

  const downloadDocx = () => {
    window.open(`/api/download/docx/${sessionId}`, '_blank')
  }

  const downloadJson = () => {
    window.open(`/api/download/json/${sessionId}`, '_blank')
  }

  const stats = feedback?.summary_statistics
  const reqFeedback = feedback?.requirement_feedback || []

  if (loading) {
    return <div className="loading">Loading results...</div>
  }

  return (
    <div className="download-page-full">
      <div className="download-header-section">
        <h2>Analysis Complete</h2>
        <p className="subtitle">Session: {sessionId}</p>

        {stats && (
          <div className="stats-row">
            <div className="stat-box">
              <span className="stat-number">{stats.total_requirements}</span>
              <span className="stat-label">Requirements</span>
            </div>
            <div className="stat-box">
              <span className="stat-number">{stats.total_violations}</span>
              <span className="stat-label">Violations</span>
            </div>
            <div className="stat-box accept-stat">
              <span className="stat-number">{stats.actions?.accept || 0}</span>
              <span className="stat-label">Accepted</span>
            </div>
            <div className="stat-box reject-stat">
              <span className="stat-number">{stats.actions?.reject || 0}</span>
              <span className="stat-label">Rejected</span>
            </div>
            <div className="stat-box modify-stat">
              <span className="stat-number">{stats.actions?.modify || 0}</span>
              <span className="stat-label">Modified</span>
            </div>
          </div>
        )}

        <div className="download-buttons-row">
          <button className="btn-primary" onClick={downloadDocx}>Download Report (.docx)</button>
          <button className="btn-secondary" onClick={downloadJson}>Download Feedback (.json)</button>
        </div>
      </div>

      {reqFeedback.length > 0 && (
        <div className="feedback-results">
          <h3>Your Feedback Summary</h3>
          {reqFeedback.map((req) => {
            const reqAnalysis = analysis?.requirements?.find((r) => r.req_id === req.req_id)
            return (
              <div key={req.req_id} className="feedback-req-card">
                <div className="feedback-req-header">
                  <strong>Requirement {req.req_id}</strong>
                </div>

                <div className="feedback-original">
                  <label>Original:</label>
                  <p>{req.original_text}</p>
                </div>

                {req.violation_feedback?.length > 0 && (
                  <div className="feedback-violations">
                    {req.violation_feedback.map((vf) => {
                      const violation = reqAnalysis?.violations?.find(
                        (v) => v.violation_id === vf.violation_id
                      )
                      return (
                        <div key={vf.violation_id} className="feedback-violation-row">
                          <span className="rule-badge">{vf.rule_id}</span>
                          <span className={`action-badge ${vf.user_action}`}>
                            {vf.user_action}
                          </span>
                          <span className="feedback-detail">
                            {violation && (
                              <span className="affected-text">"{violation.affected_text}"</span>
                            )}
                            {' → '}
                            <span className="final-text">"{vf.user_text}"</span>
                          </span>
                          {vf.notes && <span className="feedback-note">({vf.notes})</span>}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="feedback-final">
                  <label>Final:</label>
                  <p>{req.final_text}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {stats?.acceptance_rate_by_rule && Object.keys(stats.acceptance_rate_by_rule).length > 0 && (
        <div className="rule-stats-section">
          <h3>Acceptance Rate by Rule</h3>
          <table className="rule-stats-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Accept</th>
                <th>Reject</th>
                <th>Modify</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.acceptance_rate_by_rule).map(([ruleId, rs]) => (
                <tr key={ruleId}>
                  <td><strong>{ruleId}</strong></td>
                  <td>{rs.accept}</td>
                  <td>{rs.reject}</td>
                  <td>{rs.modify}</td>
                  <td>{(rs.rate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="nav-links">
        <Link to="/">Start New Analysis</Link>
      </div>
    </div>
  )
}
