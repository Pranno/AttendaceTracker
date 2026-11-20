// Holidays found in a pasted message (either reader) — check, edit, then add
// them to Settings → Semester & classes → Holidays. Used by both paste boxes.

import { useEffect, useState } from 'react'
import { useApp } from '../data/store'
import type { ExtractedHoliday } from '../logic/holidays'
import { formatShort } from '../logic/dates'

export default function FoundHolidays({ items }: { items: ExtractedHoliday[] }) {
  const { data, addHoliday } = useApp()
  const [list, setList] = useState(items)
  const [checked, setChecked] = useState<boolean[]>(items.map(() => true))
  const [added, setAdded] = useState<string | null>(null)

  useEffect(() => {
    setList(items)
    setChecked(items.map(() => true))
    setAdded(null)
  }, [items])

  if (list.length === 0) return null
  const exists = (h: ExtractedHoliday) =>
    data.holidays.some((x) => !x.isExamDay && x.startDate === h.startDate && x.endDate === h.endDate)
  const chosen = list.filter((h, i) => checked[i] && !exists(h))

  function add() {
    for (const h of chosen) {
      addHoliday({ label: h.label.trim() || 'Holiday', startDate: h.startDate, endDate: h.endDate, isExamDay: false })
    }
    setAdded(`Added ${chosen.length} holiday${chosen.length === 1 ? '' : 's'} — those days’ classes won’t count.`)
  }

  const update = (i: number, patch: Partial<ExtractedHoliday>) =>
    setList((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch, tentative: patch.startDate || patch.endDate ? false : x.tentative } : x)))

  return (
    <div className="found-holidays">
      <div className="small-label">🎉 Holidays found · {list.length}</div>
      {list.map((h, i) => (
        <div key={i} className="card extract-item">
          <button
            className={`extract-check${checked[i] && !exists(h) ? ' on' : ''}`}
            aria-label={checked[i] ? 'Skip this one' : 'Include this one'}
            disabled={exists(h)}
            onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
          >
            {checked[i] && !exists(h) ? '✓' : ''}
          </button>
          <div className="extract-main">
            <input className="extract-title-input" value={h.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Holiday name" />
            <div className="extract-meta">
              {h.startDate === h.endDate ? formatShort(h.startDate) : `${formatShort(h.startDate)} – ${formatShort(h.endDate)}`}
              {h.tentative ? ' · next year?' : ''}
              {exists(h) ? ' · already in your holidays' : ''}
            </div>
            <div className="found-holiday-dates">
              <input type="date" value={h.startDate} onChange={(e) => e.target.value && update(i, { startDate: e.target.value, endDate: e.target.value > h.endDate ? e.target.value : h.endDate })} aria-label="First day off" />
              <span>to</span>
              <input type="date" value={h.endDate} min={h.startDate} onChange={(e) => e.target.value && update(i, { endDate: e.target.value })} aria-label="Last day off" />
            </div>
          </div>
        </div>
      ))}
      {added ? (
        <div className="msg" style={{ color: 'var(--safe)', fontWeight: 700 }}>{added}</div>
      ) : (
        <button className="secondary big-btn" onClick={add} disabled={chosen.length === 0}>
          Add {chosen.length} holiday{chosen.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}
