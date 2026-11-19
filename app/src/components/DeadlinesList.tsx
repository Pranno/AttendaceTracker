// Every upcoming deadline in one list, closest first — grouped into
// Overdue · Today · This week · Later, with a collapsed Done group.
// Opened from the home screen's "Deadlines" tile and "See all".

import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useApp } from '../data/store'
import type { Deadline } from '../data/model'
import { diffDays, formatShort, todayStr } from '../logic/dates'
import { subjectPalette } from '../theme/tokens'
import { Sheet } from './ui/parts'

function whenText(days: number): string {
  if (days < -1) return `${-days} days overdue`
  if (days === -1) return 'yesterday'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export default function DeadlinesList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, toggleDeadlineDone, deleteDeadline } = useApp()
  const [showDone, setShowDone] = useState(false)
  const today = todayStr()

  const byDue = (a: Deadline, b: Deadline) => a.dueDate.localeCompare(b.dueDate) || (a.time ?? '').localeCompare(b.time ?? '')
  const pending = data.deadlines.filter((d) => !d.done).sort(byDue)
  const done = data.deadlines.filter((d) => d.done).sort((a, b) => byDue(b, a))
  const groups: { label: string; items: Deadline[]; tone?: string }[] = [
    { label: 'Overdue', items: pending.filter((d) => d.dueDate < today), tone: 'var(--danger)' },
    { label: 'Today', items: pending.filter((d) => d.dueDate === today), tone: 'var(--limit)' },
    { label: 'This week', items: pending.filter((d) => d.dueDate > today && diffDays(today, d.dueDate) <= 7) },
    { label: 'Later', items: pending.filter((d) => diffDays(today, d.dueDate) > 7) },
  ].filter((g) => g.items.length > 0)

  const subjectIndex = (id?: string) => Math.max(0, data.subjects.findIndex((s) => s.id === id))

  function Row({ d }: { d: Deadline }) {
    const subj = data.subjects.find((s) => s.id === d.subjectId)
    const days = diffDays(today, d.dueDate)
    const pal = subjectPalette(subjectIndex(d.subjectId))
    return (
      <div className={`dl-row${d.done ? ' done' : ''}`}>
        <button
          className={`dl-check${d.done ? ' on' : ''}`}
          onClick={() => toggleDeadlineDone(d.id)}
          aria-label={d.done ? `Mark “${d.title}” not done` : `Mark “${d.title}” done`}
        >
          {d.done && <Check size={16} />}
        </button>
        <div className="dl-main">
          <span className="dl-title">{d.title}</span>
          <span className="msg">
            {subj && <span className="dl-subj" style={{ background: pal.softBg, color: pal.strong }}>{subj.shortName}</span>}
            {formatShort(d.dueDate, d.dueDate.slice(0, 4) !== today.slice(0, 4))}
            {d.time ? ` · ${d.time}` : ''}
            {!d.done && ` · ${whenText(days)}`}
            {d.tentative ? ' · date unsure' : ''}
          </span>
        </div>
        <button
          className="icon-btn small"
          onClick={() => { if (window.confirm(`Delete “${d.title}”?`)) deleteDeadline(d.id) }}
          aria-label={`Delete ${d.title}`}
        >
          <Trash2 size={16} />
        </button>
      </div>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Deadlines · ${pending.length} to do`}>
      <div className="dl-list">
        {pending.length === 0 && (
          <div className="card empty-card">Nothing due. Paste a college message on the home screen to add deadlines.</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="small-label dl-group" style={g.tone ? { color: g.tone } : undefined}>
              {g.label} · {g.items.length}
            </div>
            {g.items.map((d) => <Row key={d.id} d={d} />)}
          </div>
        ))}
        {done.length > 0 && (
          <>
            <button className="link-btn dl-done-toggle" onClick={() => setShowDone((s) => !s)}>
              {showDone ? 'Hide' : 'Show'} done ({done.length})
            </button>
            {showDone && done.map((d) => <Row key={d.id} d={d} />)}
          </>
        )}
      </div>
    </Sheet>
  )
}
