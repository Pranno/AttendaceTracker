// Floating pill navigation (G2) — the signature control of the app.
// - Rounded pill floating 12–16px above the bottom edge, inset from the sides
// - Soft shadow + slight blur so content shows faintly behind it
// - Four items: Today, Calendar, Subjects, Settings (plus Plan deep-link tab)
// - Round gradient quick-add button beside the bar → opens the quick-add sheet
// - Hides on scroll down, returns on scroll up; respects safe area

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, CalendarRange, GraduationCap, LayoutGrid, Plus, Settings2, SunMedium } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet } from './ui/parts'
import { useApp } from '../data/store'
import type { ClassType, DateStr } from '../data/model'
import { todayStr } from '../logic/dates'
import PasteDeadlineSheet from './PasteDeadlineSheet'

export type Tab = 'today' | 'calendar' | 'plan' | 'study' | 'subjects' | 'settings'

const ITEMS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'today', label: 'Today', icon: SunMedium },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: CalendarRange },
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'subjects', label: 'Subjects', icon: LayoutGrid },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export default function NavBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [hidden, setHidden] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
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

      <QuickAddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onOpenPaste={() => {
          setAddOpen(false)
          setPasteOpen(true)
        }}
      />

      <PasteDeadlineSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </>
  )
}

// Quick add: paste a reminder (D1/D2), add a lecture by hand, add a deadline.
function QuickAddSheet({
  open,
  onClose,
  onOpenPaste,
}: {
  open: boolean
  onClose: () => void
  onOpenPaste: () => void
}) {
  const { data, addDeadline, addSlot } = useApp()
  const today: DateStr = todayStr()
  const [kind, setKind] = useState<'reminder' | 'lecture' | 'deadline'>('deadline')

  // lecture mini-form
  const [weekday, setWeekday] = useState(1)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [type, setType] = useState<ClassType>('lecture')
  const [room, setRoom] = useState('')
  const [teacher, setTeacher] = useState('')
  const [batch, setBatch] = useState('')

  // deadline mini-form
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(today)
  const [subjectId, setSubjectId] = useState('')

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
        <button className={`chip ${kind === 'deadline' ? 'on' : ''}`} onClick={() => setKind('deadline')}>
          Deadline
        </button>
        <button className={`chip ${kind === 'lecture' ? 'on' : ''}`} onClick={() => setKind('lecture')}>
          Lecture
        </button>
        <button className={`chip ${kind === 'reminder' ? 'on' : ''}`} onClick={() => setKind('reminder')}>
          Paste a message
        </button>
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
        <div className="card">
          <div className="field-row">
            <label>Subject</label>
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
              <option value="">—</option>
              {data.subjects.map(s => (
                <option key={s.id} value={s.id}>{s.shortName} — {s.fullName}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Day</label>
            <select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>
              {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d,i)=> (
                <option key={i+1} value={i+1}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Start</label>
            <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} />
            <label>End</label>
            <input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} />
          </div>
          <div className="field-row">
            <label>Type</label>
            <select value={type} onChange={e=>setType(e.target.value as ClassType)}>
              <option value="lecture">Lecture</option>
              <option value="lab">Lab</option>
              <option value="tutorial">Tutorial</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div className="field-row">
            <label>Room</label>
            <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="B-204" />
            <label>Teacher</label>
            <input value={teacher} onChange={e=>setTeacher(e.target.value)} placeholder="Prof X" />
          </div>
          <div className="field-row">
            <label>Batch</label>
            <input value={batch} onChange={e=>setBatch(e.target.value)} placeholder={data.settings.myBatch || 'A1'} />
          </div>
          <button className="primary big-btn" onClick={() => {
            const sid = subjectId || data.subjects[0]?.id;
            if (!sid) return;
            addSlot({
              subjectId: sid,
              weekday,
              startTime,
              endTime,
              type,
              room: room.trim(),
              teacher: teacher.trim(),
              batch: batch.trim().toUpperCase() || undefined,
              validFrom: today,
              validUntil: null,
            });
            onClose();
          }}>Add lecture</button>
        </div>
      )}

      {kind === 'reminder' && (
        <div>
          <div className="msg" style={{ marginBottom: 12 }}>
            Paste any WhatsApp message, email, or college notice to automatically extract dates and subject.
          </div>
          <button className="primary big-btn" onClick={onOpenPaste}>
            Open paste box
          </button>
        </div>
      )}
    </Sheet>
  )
}
