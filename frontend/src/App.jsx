import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'
import DownloadPage from './pages/DownloadPage'
import SessionSetupPage from './pages/SessionSetupPage'
import ConsensusPage from './pages/ConsensusPage'

function Header() {
  const location = useLocation()
  const path = location.pathname

  const steps = [
    { label: '1. Upload', match: '/' },
    { label: '2. Setup', match: '/setup' },
    { label: '3. Review', match: '/review' },
    { label: '4. Consensus', match: '/consensus' },
    { label: '5. Download', match: '/download' },
  ]

  return (
    <header className="app-header">
      <h1>INCOSE Requirements Analyzer</h1>
      <nav className="step-nav">
        {steps.map((step, i) => (
          <span
            key={i}
            className={`step ${path.startsWith(step.match) && (step.match !== '/' || path === '/') ? 'active' : ''}`}
          >
            {step.label}
          </span>
        ))}
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/setup/:sessionId" element={<SessionSetupPage />} />
          <Route path="/review/:sessionId" element={<ReviewPage />} />
          <Route path="/consensus/:sessionId" element={<ConsensusPage />} />
          <Route path="/download/:sessionId" element={<DownloadPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
