import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

function ProgressBar({ active, pct }) {
  return (
    <div style={{
      height: 8, borderRadius: 4, background: '#e5e7eb',
      overflow: 'hidden', margin: '12px 0',
      display: active ? 'block' : 'none',
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: 'linear-gradient(90deg, #3b82f6, #6366f1)',
        borderRadius: 4,
        transition: 'width 0.4s ease',
      }} />
    </div>
  )
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
  { value: 'openai',    label: 'OpenAI (GPT-4o)',    placeholder: 'sk-...'     },
]

export default function UploadPage() {
  const navigate = useNavigate()
  const [provider, setProvider]               = useState('anthropic')
  const [apiKey, setApiKey]                   = useState('')
  // serverKeys = { anthropic: bool, openai: bool } — which providers have keys in .env
  const [serverKeys, setServerKeys]           = useState({})
  const [reqFile, setReqFile]                 = useState(null)
  const [ctxFile, setCtxFile]                 = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState('')
  const [progress, setProgress]               = useState('')
  const [sessionResult, setSessionResult]     = useState(null)
  const [barPct, setBarPct]                   = useState(0)
  const timerRef = useRef(null)

  const currentProvider = PROVIDERS.find(p => p.value === provider)

  // Single config fetch on mount — retries until backend is ready.
  // Never re-runs; never races with anything else.
  useEffect(() => {
    let cancelled = false
    const poll = async (attemptsLeft = 20) => {
      try {
        const res = await axios.get('/api/config', { timeout: 2000 })
        if (cancelled) return
        const p = res.data.provider || 'anthropic'
        setProvider(p)
        setServerKeys(res.data.keys || {})
      } catch {
        if (cancelled || attemptsLeft <= 0) return
        setTimeout(() => poll(attemptsLeft - 1), 2000)
      }
    }
    poll()
    return () => { cancelled = true }
  }, []) // ← empty deps: runs once, never again

  // Green banner shows when the selected provider has a key configured in .env
  const keyIsConfigured = !!serverKeys[provider]

  // Progress bar animation
  useEffect(() => {
    if (loading) {
      setBarPct(5)
      let pct = 5
      timerRef.current = setInterval(() => {
        pct += pct < 60 ? 6 : pct < 80 ? 2 : 0.5
        if (pct >= 88) pct = 88
        setBarPct(pct)
      }, 600)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [loading])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reqFile) {
      setError('Please select a requirements file.')
      return
    }
    // Only require API key in UI if server doesn't already have one for this provider
    if (!keyIsConfigured && !apiKey.trim()) {
      setError(`Please enter your ${currentProvider.label} API key, or add it to backend/.env`)
      return
    }

    setLoading(true)
    setError('')
    setProgress('Analyzing requirements against A2–A10 criteria...')

    const formData = new FormData()
    formData.append('requirements_file', reqFile)
    if (ctxFile) formData.append('context_file', ctxFile)

    try {
      const res = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-API-Key': apiKey.trim(),       // empty string if using .env key
          'X-AI-Provider': provider,
        },
        timeout: 600000,
      })

      setBarPct(100)
      const violated = res.data.violations_count
      setProgress(`Done! ${violated} criteria violated across ${res.data.requirements_count} requirements.`)
      setTimeout(() => setSessionResult(res.data.session_id), 400)
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Upload failed'
      setError(msg)
      setBarPct(0)
      setLoading(false)
      setProgress('')
    }
  }

  return (
    <div className="upload-page">
      <div className="upload-card">
        <h2>Upload Requirements</h2>
        <p className="subtitle">
          Analyze requirements against INCOSE quality criteria using AI.
          Upload your requirements document and optional context file.
        </p>

        <form onSubmit={handleSubmit}>

          {/* Provider selector */}
          <div className="form-group">
            <label>AI Provider *</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  disabled={loading}
                  onClick={() => { setProvider(p.value); setApiKey('') }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `2px solid ${provider === p.value ? '#3b82f6' : '#374151'}`,
                    background: provider === p.value ? '#1e3a5f' : '#1f2937',
                    color: provider === p.value ? '#93c5fd' : '#9ca3af',
                    fontWeight: provider === p.value ? 700 : 400,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          {keyIsConfigured ? (
            <div className="form-group">
              <div style={{
                padding: '8px 12px', borderRadius: 6,
                background: '#052e16', border: '1px solid #166534',
                color: '#86efac', fontSize: 13,
              }}>
                API key configured in <code>backend/.env</code> — no key entry needed.
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="api-key">{currentProvider.label} API Key *</label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                placeholder={currentProvider.placeholder}
                style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }}
              />
              <p className="hint">
                Or add it to <code>backend/.env</code> to avoid entering it here each time.
              </p>
            </div>
          )}

          {/* Requirements file */}
          <div className="form-group">
            <label htmlFor="req-file">Requirements File (.txt) *</label>
            <input
              id="req-file"
              type="file"
              accept=".txt"
              onChange={(e) => setReqFile(e.target.files[0])}
              disabled={loading}
            />
            <p className="hint">
              Format: "1. The system shall...", "REQ-001: The system shall...", "MR-C1.1: The system shall..."
            </p>
          </div>

          {/* Context file */}
          <div className="form-group">
            <label htmlFor="ctx-file">Context File (.txt, optional)</label>
            <input
              id="ctx-file"
              type="file"
              accept=".txt"
              onChange={(e) => setCtxFile(e.target.files[0])}
              disabled={loading}
            />
            <p className="hint">
              Describe the system (e.g., "This system is a UAV flight control system for...")
            </p>
          </div>

          {error && <div className="error-msg">{error}</div>}
          <ProgressBar active={loading} pct={barPct} />
          {progress && <div className="progress-msg">{progress}</div>}

          {!sessionResult ? (
            <button type="submit" disabled={loading || !reqFile} className="btn-primary">
              {loading ? 'Analyzing...' : 'Upload & Analyze'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate(`/review/${sessionResult}`)}
              >
                Review Solo
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate(`/setup/${sessionResult}`)}
              >
                Set Up Multi-Reviewer
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
