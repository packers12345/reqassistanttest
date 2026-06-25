import { useState, useMemo } from 'react'

const COLORS = {
  satisfied: { border: '#86efac', leftBar: '#22c55e', bg: '#f0fdf4', badge: '#16a34a', text: '#15803d' },
  violated:  { border: '#fcd34d', leftBar: '#f59e0b', bg: '#fffbeb', badge: '#b45309', text: '#92400e' },
}

export default function CriterionCard({ evaluation, originalText, feedback, onFeedbackChange }) {
  const [showSatisfiedEdit, setShowSatisfiedEdit] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const { criterion_id, criterion_name, satisfied, explanation, affected_text, suggested_replacement } = evaluation
  const c = satisfied ? COLORS.satisfied : COLORS.violated

  const handleActionChange = (action) => {
    const next = { ...feedback, user_action: action }
    if (action === 'accept') next.user_text = suggested_replacement || affected_text || ''
    if (action === 'reject') next.user_text = affected_text || ''
    if (action === 'modify') next.user_text = next.user_text || suggested_replacement || affected_text || ''
    onFeedbackChange(next)
  }

  // Live preview for accept (suggested), modify (user text), reject (original unchanged)
  const preview = useMemo(() => {
    if (!feedback.user_action || !originalText) return null
    if (feedback.user_action === 'reject') {
      return originalText // no change
    }
    if (!affected_text) return null
    const pos = originalText.indexOf(affected_text)
    if (pos === -1) return originalText
    const replacement =
      feedback.user_action === 'accept'
        ? (suggested_replacement || affected_text)
        : (feedback.user_text || affected_text)
    return (
      originalText.slice(0, pos) +
      '⟪' + replacement + '⟫' +
      originalText.slice(pos + affected_text.length)
    )
  }, [originalText, affected_text, suggested_replacement, feedback])

  return (
    <div style={{
      border: `1px solid ${c.border}`,
      borderLeft: `4px solid ${c.leftBar}`,
      borderRadius: 6,
      padding: '11px 14px',
      marginBottom: 9,
      background: c.bg,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
        <span style={{
          background: c.badge, color: '#fff',
          borderRadius: 4, padding: '2px 7px',
          fontWeight: 700, fontSize: 12,
        }}>
          {criterion_id}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{criterion_name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: c.text }}>
          {satisfied ? '✓ Satisfied' : '✗ Violated'}
        </span>
      </div>

      {/* Explanation */}
      <p style={{ margin: '0 0 8px', fontSize: 13, color: '#555', lineHeight: 1.5 }}>
        {explanation}
      </p>

      {/* VIOLATED: current + recommendations boxes */}
      {!satisfied && (
        <div style={{ display: 'flex', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
          {/* CURRENT box */}
          {affected_text && (
            <div style={{
              flex: '0 0 auto', maxWidth: '45%',
              background: '#fee2e2', border: '1px solid #fca5a5',
              borderRadius: 4, padding: '6px 10px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#991b1b', marginBottom: 3, letterSpacing: 0.5 }}>CURRENT</div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7f1d1d' }}>{affected_text}</span>
            </div>
          )}

          {/* SUGGESTED box — AI-rewritten replacement for the affected substring */}
          {suggested_replacement && (
            <div style={{
              flex: 1, minWidth: 160,
              background: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 4, padding: '6px 10px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', marginBottom: 3, letterSpacing: 0.5 }}>SUGGESTED</div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#1e3a8a' }}>{suggested_replacement}</span>
            </div>
          )}
        </div>
      )}

      {/* VIOLATED: action buttons */}
      {!satisfied && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 9, flexWrap: 'wrap' }}>
          {['accept', 'reject', 'modify'].map((action) => {
            const isSelected = feedback.user_action === action
            const accent = action === 'accept' ? '#16a34a' : action === 'reject' ? '#6b7280' : '#2563eb'
            return (
              <button
                key={action}
                type="button"
                onClick={() => handleActionChange(action)}
                style={{
                  padding: '4px 13px', borderRadius: 4,
                  border: `1px solid ${accent}`,
                  cursor: 'pointer', fontSize: 12, fontWeight: isSelected ? 700 : 400,
                  background: isSelected ? accent : '#fff',
                  color: isSelected ? '#fff' : accent,
                  transition: 'all 0.15s',
                }}
              >
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </button>
            )
          })}
        </div>
      )}

      {/* Modify text input */}
      {!satisfied && feedback.user_action === 'modify' && (
        <div style={{ marginBottom: 9 }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: '#374151' }}>
            Your replacement text:
          </label>
          <input
            type="text"
            value={feedback.user_text || ''}
            onChange={(e) => onFeedbackChange({ ...feedback, user_text: e.target.value, user_action: 'modify' })}
            placeholder={affected_text || 'Enter your replacement...'}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 8px', borderRadius: 4,
              border: '1px solid #93c5fd', fontSize: 13,
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Live preview — only for Modify */}
      {preview && (
        <div style={{
          background: '#fef9c3', border: '1px solid #fde047',
          borderRadius: 4, padding: '7px 10px', marginBottom: 9,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#713f12', marginBottom: 3, letterSpacing: 0.5 }}>PREVIEW</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#1c1917' }}>{preview}</p>
        </div>
      )}

      {/* Notes (violated only) */}
      {!satisfied && (
        <div>
          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#9ca3af', padding: 0, textDecoration: 'underline' }}
          >
            {showNotes ? 'Hide notes' : 'Add notes'}
          </button>
          {showNotes && (
            <input
              type="text"
              value={feedback.notes || ''}
              onChange={(e) => onFeedbackChange({ ...feedback, notes: e.target.value })}
              placeholder="Optional notes..."
              style={{ display: 'block', marginTop: 5, width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }}
            />
          )}
        </div>
      )}

      {/* SATISFIED: optional suggest change toggle */}
      {satisfied && (
        <div style={{ marginTop: 2 }}>
          <button
            type="button"
            onClick={() => setShowSatisfiedEdit(!showSatisfiedEdit)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#6b7280', padding: 0, textDecoration: 'underline' }}
          >
            {showSatisfiedEdit ? 'Cancel' : 'Suggest a change anyway'}
          </button>
          {showSatisfiedEdit && (
            <div style={{ marginTop: 6 }}>
              <input
                type="text"
                value={feedback.user_text || ''}
                onChange={(e) => onFeedbackChange({ ...feedback, user_text: e.target.value, user_action: 'modify' })}
                placeholder="Describe your suggested modification..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
