// Floating pill navigation (G2) — the signature control of the app.
// - Rounded pill floating 12–16px above the bottom edge, inset from the sides
// - Soft shadow + slight blur so content shows faintly behind it
// - Four items: Today, Calendar, Subjects, Settings; active item is a filled
//   pill whose background SLIDES from item to item with a springy animation
// - Round gradient quick-add button beside the bar → opens the quick-add sheet
// - Hides on scroll down, returns on scroll up; respects safe area

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, CalendarRange, LayoutGrid, Plus, Settings2, SunMedium } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet } from './ui/parts'
import { useApp } from '../data/store'
import type { DateStr } from '../data/model'
import { todayStr } from '../logic/dates'

export type Tab = 'today' | 'calendar' | 'plan' | 'subjects' | 'settings'

const ITEMS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'today', label: 'Today', icon: SunMedium },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: CalendarRange },
  { id: 'subjects', label: 'Subjects', icon: LayoutGrid },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export default function NavBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [hidden, setHidden] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const lastY = useRef(window.scrollY)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  // Slide the filled pill behind the active item.
  useEffect(() => {
    const el = itemRefs.current[tab]
    const parent = el?.parentElement
    if (el && parent) {
      const pr = parent.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      setPillStyle({ left: r.left - pr.left, width: r.width })
    }
  }, [tab])

  // Hide on scroll down, return on scroll up.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y > lastY.current + 12 && y > 80) setHidden(true)
      else if (y < lastY.current - 12) setHidden(false)
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <div className={`navdock ${hidden ? 'down' : ''}`}>
        <nav className="pillnav" aria-label="Main">
          <span
            className="pillnav-active"
            style={{ left: pillStyle.left, width: pillStyle.width }}
            aria-hidden
          />
          {ITEMS.map((it) => {
            const Icon = it.icon
            const active = it.id === tab
            return (
              <button
                key={it.id}
                ref={(el) => (itemRefs.current[it.id] = el)}
                className={`navitem ${active ? 'on' : ''}`}
                onClick={() => onChange(it.id)}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                <span>{it.label}</span>
              </button>
            )
          })}
        </nav>
        <button className="fab" onClick={() => setAddOpen(true)} aria-label="Quick add">
          <Plus size={26} strokeWidth={2.6} />
        </button>
      </div>
      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} goSettings={() => onChange('settings')} />
    </>
  )
}

// Quick add: paste a reminder (placeholder until Step 5), add a lecture by hand
// (works now — reuses the store), add a deadline (works now).
function QuickAddSheet({ open, onClose, goSettings }: { open: boolean; onClose: () => void; goSettings: () => void }) {
  const { data, addDeadline } = useApp()
  const today: DateStr = todayStr()
  const [kind, setKind] = useState<'reminder' | 'lecture' | 'deadline'>('deadline')

  // deadline mini-form
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(today)
  const [subjectId, setSubjectId] = useState('')

  // lecture shortcut: the full form lives in Subjects → Timetable (step 3 polish)
  function submitDeadline() {
    if (!title.trim()) return
    addDeadline({
      title: title.trim(),
      dueDate: due,
      subjectId: subjectId || undefined,
      notes: '',
      sourceText: '',
    })
    setTitle('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Quick add">
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <button className={`chip ${kind === 'deadline' ? 'on' : ''}`} onClick={() => setKind('deadline')}>Deadline</button>
        <button className={`chip ${kind === 'lecture' ? 'on' : ''}`} onClick={() => setKind('lecture')}>Lecture</button>
        <button className={`chip ${kind === 'reminder' ? 'on' : ''}`} onClick={() => setKind('reminder')}>Paste a message</button>
      </div>

      {kind === 'deadline' && (
        <div>
          <label className="small-label">What is due?</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Maths worksheet" />
          <div className="field-row">
            <div className="grow">
              <label className="small-label">Due date</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="grow">
              <label className="small-label">Subject (optional)</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">—</option>
                {data.subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.shortName}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="primary big-btn" style={{ marginTop: 12 }} onClick={submitDeadline}>
            Add deadline
          </button>
        </div>
      )}

      {kind === 'lecture' && (
        <div className="msg">
          Open <b>Subjects → Timetable</b> to add a lecture by hand — it repeats every week automatically.
          <button className="primary" style={{ marginTop: 10 }} onClick={() => { onClose(); goSettings() }}>
            Not now
          </button>
        </div>
      )}

      {kind === 'reminder' && (
        <div className="msg">
          Pasting a college message to make a deadline arrives in Step 5. For now, add it as a deadline above.
        </div>
      )}
    </Sheet>
  )
}
