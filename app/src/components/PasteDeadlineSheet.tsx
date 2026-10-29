// PasteDeadlineSheet — Modal sheet for pasting college deadline messages (D1–D5).
// Available on Today screen, Calendar, and Quick-add.

import { useState } from 'react'
import { ClipboardPaste, Check } from 'lucide-react'
import { useApp } from '../data/store'
import { Sheet } from './ui/parts'
import { extractDeadlines, type ExtractedDeadline } from '../logic/deadlines'
import { todayStr, formatShort } from '../logic/dates'

export default function PasteDeadlineSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { data, addDeadline } = useApp()
  const [text, setText] = useState('')
  const [results, setResults] = useState<ExtractedDeadline[] | null>(null)
  const [checked, setChecked] = useState<boolean[]>([])
  const [savedCount, setSavedCount] = useState<number | null>(null)

  function runExtraction() {
    if (!text.trim()) return
    const res = extractDeadlines(text, todayStr(), data.subjects)
    setResults(res)
    setChecked(res.map(() => true))
    setSavedCount(null)
  }

  function handleSave() {
    if (!results) return
    let count = 0
    results.forEach((d, i) => {
      if (!checked[i]) return
      // Match hint to subject
      const sub = d.subjectHint
        ? data.subjects.find(
            (s) =>
              s.shortName.toLowerCase() === d.subjectHint!.toLowerCase() ||
              s.fullName.toLowerCase().includes(d.subjectHint!.toLowerCase()),
          )
        : undefined

      addDeadline({
        title: d.title,
        dueDate: d.dueDate,
        subjectId: sub?.id,
        tentative: d.tentative,
        sourceText: text.slice(0, 500),
      })
      count++
    })
    setSavedCount(count)
    setTimeout(() => {
      setResults(null)
      setText('')
      setSavedCount(null)
      onClose()
    }, 900)
  }

  function handleClose() {
    setResults(null)
    setText('')
    setSavedCount(null)
    onClose()
  }

  return (
    <Sheet open={open} onClose={handleClose} title="Paste a college message">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="msg" style={{ margin: 0 }}>
          Copy any deadline or notice from WhatsApp or email and paste it below. Fixed rules extract the due date and subject.
        </p>

        <textarea
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder={'Paste message here…\ne.g. "Maths submission of integration worksheet at 9 Nov"'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="row" style={{ gap: 8 }}>
          <button
            className="primary big-btn grow"
            disabled={text.trim().length < 4}
            onClick={runExtraction}
          >
            <ClipboardPaste size={18} />
            Extract deadline
          </button>
          {results && (
            <button
              className="danger-quiet big-btn"
              onClick={() => {
                setResults(null)
                setText('')
              }}
            >
              Clear
            </button>
          )}
        </div>

        {savedCount !== null && (
          <div className="card row" style={{ background: 'var(--safe)', color: '#fff', gap: 8 }}>
            <Check size={18} />
            <b>Saved {savedCount} deadline{savedCount === 1 ? '' : 's'} to calendar!</b>
          </div>
        )}

        {results && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.length === 0 && (
              <div className="card msg">
                No deadlines detected — check that the message has a date and a word like "submission", "due", "test", or "certificate".
              </div>
            )}

            {results.map((d, i) => (
              <div key={i} className="card extract-item">
                <button
                  className={`extract-check${checked[i] ? ' on' : ''}`}
                  aria-label={checked[i] ? 'Skip this one' : 'Include this one'}
                  onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                >
                  {checked[i] ? '✓' : ''}
                </button>
                <div className="extract-main">
                  <input
                    className="extract-title-input"
                    value={d.title}
                    onChange={(e) =>
                      setResults((rs) =>
                        rs!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                  <div className="extract-meta">
                    Due {formatShort(d.dueDate)}
                    {d.subjectHint ? ` · ${d.subjectHint}` : ''}
                    {d.tentative ? ' · next year?' : ''}
                  </div>
                </div>
                <input
                  type="date"
                  className="extract-date"
                  value={d.dueDate}
                  onChange={(e) =>
                    setResults((rs) =>
                      rs!.map((x, j) =>
                        j === i
                          ? { ...x, dueDate: e.target.value as ExtractedDeadline['dueDate'], tentative: false }
                          : x,
                      ),
                    )
                  }
                />
              </div>
            ))}

            {results.length > 0 && (
              <button
                className="primary big-btn"
                style={{ marginTop: 6 }}
                disabled={checked.filter(Boolean).length === 0}
                onClick={handleSave}
              >
                Save {checked.filter(Boolean).length} selected to Calendar
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

