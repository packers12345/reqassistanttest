import { useMemo } from 'react'
import CriterionCard from './CriterionCard'

export default function RequirementCard({ requirement, feedbackState, onFeedbackChange }) {
  const evals = requirement.criteria_evaluations || []
  const violated = evals.filter((e) => !e.satisfied)
  const satisfied = evals.filter((e) => e.satisfied)

  // Count how many violated criteria have a decision
  const decidedCount = violated.filter((e) => {
    const key = `${requirement.req_id}-${e.criterion_id}`
    return feedbackState[key]?.user_action
  }).length

  // Full preview: apply ALL accepted/modified criteria fixes to the original text
  const fullPreview = useMemo(() => {
    const original = requirement.original_text
    const replacements = []

    for (const ev of violated) {
      if (!ev.affected_text) continue
      const key = `${requirement.req_id}-${ev.criterion_id}`
      const fb = feedbackState[key]
      if (!fb?.user_action || fb.user_action === 'reject') continue

      const pos = original.indexOf(ev.affected_text)
      if (pos === -1) continue

      const replacement =
        fb.user_action === 'modify'
          ? (fb.user_text || ev.suggested_replacement || ev.affected_text)
          : (ev.suggested_replacement || ev.affected_text)

      replacements.push({ start: pos, end: pos + ev.affected_text.length, text: replacement })
    }

    if (!replacements.length) return null

    // Sort descending by start so we splice from the end
    replacements.sort((a, b) => b.start - a.start)

    // Remove overlaps (keep later-found replacement)
    const filtered = []
    let lastStart = Infinity
    for (const r of replacements) {
      if (r.end <= lastStart) { filtered.push(r); lastStart = r.start }
    }

    let result = original
    for (const { start, end, text } of filtered) {
      result = result.slice(0, start) + text + result.slice(end)
    }
    return result
  }, [requirement, feedbackState, violated])

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: '18px 20px',
      marginBottom: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      {/* Requirement header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{requirement.req_id}</h3>
        <div style={{ display: 'flex', gap: 8, fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: '#dc3545' }}>{violated.length} violated</span>
          <span style={{ color: '#6b7280' }}>·</span>
          <span style={{ color: '#16a34a' }}>{satisfied.length} satisfied</span>
          {violated.length > 0 && (
            <>
              <span style={{ color: '#6b7280' }}>·</span>
              <span style={{ color: '#6b7280' }}>{decidedCount}/{violated.length} reviewed</span>
            </>
          )}
        </div>
      </div>

      {/* Original text */}
      <div style={{
        background: '#f9fafb', borderRadius: 5,
        padding: '8px 12px', marginBottom: 14,
        fontSize: 14, lineHeight: 1.6, color: '#374151',
        borderLeft: '3px solid #9ca3af',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 3 }}>ORIGINAL</span>
        {requirement.original_text}
      </div>

      {/* Full preview (shown when at least one decision made) */}
      {fullPreview && (
        <div style={{
          background: '#eff6ff', borderRadius: 5,
          padding: '8px 12px', marginBottom: 14,
          fontSize: 14, lineHeight: 1.6, color: '#1e40af',
          borderLeft: '3px solid #3b82f6',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', display: 'block', marginBottom: 3 }}>
            COMBINED PREVIEW
          </span>
          {fullPreview}
        </div>
      )}

      {/* Criterion cards */}
      {evals.length === 0 ? (
        <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: 13 }}>
          {requirement.error ? `Analysis error: ${requirement.error}` : 'No evaluations available.'}
        </p>
      ) : (
        <div>
          {evals.map((ev) => {
            const key = `${requirement.req_id}-${ev.criterion_id}`
            const feedback = feedbackState[key] || {
              criterion_id: ev.criterion_id,
              user_action: '',
              user_text: ev.suggested_replacement || '',
              notes: '',
            }
            return (
              <CriterionCard
                key={ev.criterion_id}
                evaluation={ev}
                originalText={requirement.original_text}
                feedback={feedback}
                onFeedbackChange={(fb) => onFeedbackChange(key, fb)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
