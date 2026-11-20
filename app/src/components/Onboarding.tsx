// First-run onboarding: Welcome → Setup (4 steps that actually save your
// choices) → Tour of every area → "You're all set". Shown once on first
// launch (settings.onboarded); can be replayed from Settings → Appearance.

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Archive, Bell, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, LayoutGrid, Lock, Settings2, Sparkles, SunMedium,
} from 'lucide-react'
import { useApp } from '../data/store'
import { ensureNotifyPermission } from '../logic/reminders'
import { countFromOf } from '../logic/attendance'
import { formatShort, todayStr } from '../logic/dates'
import { SliderField, Toggle } from './ui/parts'
import type { Tab } from './NavBar'

const DIVISIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

interface TourCard {
  icon: LucideIcon
  color: string
  tab: string
  title: string
  points: ReactNode[]
}

const TOUR: TourCard[] = [
  {
    icon: SunMedium, color: '#E8604C', tab: 'Today', title: 'Your day at a glance',
    points: [
      <>Mark each class <b>Present</b>, <b>Absent</b> or <b>No class</b> — or the whole day with <b>All present</b> / <b>Holiday</b>.</>,
      <>Every class shows whether you <b>can skip</b> it or <b>must attend</b>.</>,
      <>Paste a college message to pull out its <b>deadlines and holidays</b>; tap <b>Deadlines</b> for the full list.</>,
    ],
  },
  {
    icon: LayoutGrid, color: '#7C5CE0', tab: 'Subjects', title: 'Attendance per subject',
    points: [
      <>Attended ÷ held, your percentage and this month’s <b>must attend / can skip</b> plan.</>,
      <>Open a subject for its weekly classes, its <b>own target %</b> and its <b>syllabus, unit by unit</b>.</>,
      <>The <b>CGPA planner</b> sits at the bottom.</>,
    ],
  },
  {
    icon: CalendarRange, color: '#2E9E6A', tab: 'Timetable', title: 'Your weekly timetable',
    points: [
      <>Import the college PDF with the offline <b>Standard</b> reader or <b>Smart (AI)</b> — or add classes by hand.</>,
      <>Only <b>your batch</b> and whole-class lectures are kept; 2-period labs count as one session.</>,
      <>Import each subject’s <b>syllabus</b> here too.</>,
    ],
  },
  {
    icon: CalendarDays, color: '#2D7FD3', tab: 'Calendar', title: 'The whole semester',
    points: [
      <>Every class, holiday, exam day and deadline by month.</>,
      <>Tap any past day to <b>mark attendance you missed</b>.</>,
      <>Holidays remove that day’s classes; exam days still count.</>,
    ],
  },
  {
    icon: Archive, color: '#C9852B', tab: 'Locker', title: 'A store room for each subject',
    points: [
      <><b>Notes</b> — paste anything worth keeping, shown in full like a chat.</>,
      <><b>Files</b> — PDFs and photos open right inside the app.</>,
      <><b>Links</b> — course links with a tick when you’ve completed them.</>,
    ],
  },
  {
    icon: Sparkles, color: '#D9467A', tab: 'Smart import (AI)', title: 'Optional: let AI do the reading',
    points: [
      <>Add your free <b>Gemini API key</b> in Settings — the guide there takes two minutes.</>,
      <>Then AI can read any timetable, your full syllabus, and the deadlines and holidays in messages and email.</>,
      <>Without a key everything still works offline with the Standard readers.</>,
    ],
  },
]

type StepId = 'welcome' | 'semester' | 'class' | 'rules' | 'reminders' | `tour${number}` | 'done'
const STEPS: StepId[] = ['welcome', 'semester', 'class', 'rules', 'reminders', ...TOUR.map((_, i) => `tour${i}` as StepId), 'done']
const SETUP_STEPS = 4

export default function Onboarding({ onDone }: { onDone: (goTo: Tab) => void }) {
  const { data, updateSettings } = useApp()
  const s = data.settings
  const [i, setI] = useState(0)
  const [semStart, setSemStart] = useState(s.semesterStart ?? '')
  const [semEnd, setSemEnd] = useState(s.semesterEnd ?? '')
  const [semName, setSemName] = useState(s.semesterName ?? '')
  const [notifyState, setNotifyState] = useState<'idle' | 'granted' | 'denied'>('idle')
  const [touchX, setTouchX] = useState<number | null>(null)
  const step = STEPS[i]
  const division = (s.myDivision || s.myBatch.slice(0, 1)).toUpperCase()
  const batchNum = /^[A-Za-z](\d+)$/.exec(s.myBatch)?.[1] ?? ''

  function saveSemester() {
    const patch: Parameters<typeof updateSettings>[0] = { semesterName: semName.trim() }
    if (semStart && semEnd && semEnd >= semStart) {
      patch.semesterStart = semStart
      patch.semesterEnd = semEnd
    }
    updateSettings(patch)
  }

  function next() {
    if (step === 'semester') saveSemester()
    setI((x) => Math.min(STEPS.length - 1, x + 1))
  }
  function back() {
    setI((x) => Math.max(0, x - 1))
  }
  function finish(goTo: Tab) {
    if (step === 'semester') saveSemester()
    updateSettings({ onboarded: true })
    onDone(goTo)
  }

  const semError = semStart && semEnd && semEnd < semStart ? 'The end date must be after the start date.' : null
  const canContinue = step !== 'semester' || !semError

  // progress label
  const tourIdx = step.startsWith('tour') ? Number(step.slice(4)) : -1
  const setupIdx = ['semester', 'class', 'rules', 'reminders'].indexOf(step)
  const label =
    setupIdx >= 0 ? `Set up · ${setupIdx + 1} of ${SETUP_STEPS}` : tourIdx >= 0 ? `Tour · ${tourIdx + 1} of ${TOUR.length}` : ''

  let body: ReactNode
  if (step === 'welcome') {
    body = (
      <div className="onb-welcome">
        <div className="onb-logo" aria-hidden><CheckCircle2 size={44} /></div>
        <h1>Attendance Tracker</h1>
        <p className="onb-lead">Know exactly where you stand in every subject — and never miss a deadline.</p>
        <ul className="onb-values">
          <li><span>📊</span><div><b>Accurate attendance</b><br />Per-subject percentages, how many you can skip, and a plan for the month.</div></li>
          <li><span>⏰</span><div><b>Deadlines & holidays</b><br />Paste a college message or connect Gmail — they’re picked out for you.</div></li>
          <li><span>🗄️</span><div><b>Everything in one place</b><br />Timetable, syllabus, notes, files and course links for each subject.</div></li>
        </ul>
        <p className="onb-privacy"><Lock size={14} /> No account. Your data stays on this phone.</p>
      </div>
    )
  } else if (step === 'semester') {
    body = (
      <>
        <h2>When does your semester run?</h2>
        <p className="onb-sub">Classes are counted from the start date, and the monthly plan runs to the end date. You can change these any time in Settings.</p>
        <label className="onb-field">
          <span>Semester name <em>(optional)</em></span>
          <input value={semName} onChange={(e) => setSemName(e.target.value)} placeholder="e.g. Semester 1, 2026–27" />
        </label>
        <div className="onb-two">
          <label className="onb-field">
            <span>First day of college</span>
            <input type="date" value={semStart} onChange={(e) => setSemStart(e.target.value)} />
          </label>
          <label className="onb-field">
            <span>Last day (approx.)</span>
            <input type="date" value={semEnd} min={semStart || undefined} onChange={(e) => setSemEnd(e.target.value)} />
          </label>
        </div>
        {semError && <p className="onb-error">{semError}</p>}
      </>
    )
  } else if (step === 'class') {
    body = (
      <>
        <h2>Which class are you in?</h2>
        <p className="onb-sub">Timetables list every batch. Picking yours means you only see — and are only counted for — your own classes plus whole-class lectures.</p>
        <div className="onb-label">Division</div>
        <div className="onb-chips">
          {DIVISIONS.map((d) => (
            <button key={d} className={`chip${division === d ? ' on' : ''}`} onClick={() => updateSettings({ myDivision: d, myBatch: `${d}${batchNum}` })}>
              {d}
            </button>
          ))}
        </div>
        <div className="onb-label">Batch</div>
        <div className="onb-chips">
          {['', '1', '2', '3', '4'].map((n) => (
            <button
              key={n || 'none'}
              disabled={!division}
              className={`chip${division && batchNum === n ? ' on' : ''}`}
              onClick={() => updateSettings({ myBatch: `${division}${n}`, myDivision: division })}
            >
              {n ? `${division || '?'}${n}` : 'Whole class only'}
            </button>
          ))}
        </div>
        <p className="onb-note">{s.myBatch ? <>You’ll see <b>{s.myBatch}</b> classes + whole-class lectures.</> : 'Not sure yet? Skip — you can set it in Settings later.'}</p>
      </>
    )
  } else if (step === 'rules') {
    body = (
      <>
        <h2>How should attendance be counted?</h2>
        <SliderField label="Minimum attendance to keep" value={s.threshold} min={50} max={100} onChange={(n) => updateSettings({ threshold: n })} hint="Warnings and “can skip” numbers use this." />
        <div className="onb-label">Count from</div>
        <button className={`onb-option${!s.ignorePastAttendance ? ' on' : ''}`} onClick={() => updateSettings({ ignorePastAttendance: false })}>
          <b>The whole semester</b>
          <span>Classes since the semester start count. Ones you don’t mark are assumed attended at the % below.</span>
        </button>
        <button className={`onb-option${s.ignorePastAttendance ? ' on' : ''}`} onClick={() => updateSettings({ ignorePastAttendance: true })}>
          <b>Today onwards</b>
          <span>Start fresh: only classes you mark from {formatShort(s.ignorePastAttendance ? countFromOf(data, todayStr()) : todayStr())} count.</span>
        </button>
        {!s.ignorePastAttendance && (
          <SliderField label="Assumed attendance for past unmarked classes" value={s.assumedPastAttendance} min={0} max={100} onChange={(n) => updateSettings({ assumedPastAttendance: n })} />
        )}
      </>
    )
  } else if (step === 'reminders') {
    body = (
      <>
        <h2>Stay on top of things</h2>
        <p className="onb-sub">Reminders arrive as phone notifications.</p>
        <div className="onb-row">
          <div><b>Evening reminder</b><span>A nudge if today’s classes aren’t all marked.</span></div>
          <Toggle checked={s.eveningReminderOn} onChange={(v) => updateSettings({ eveningReminderOn: v })} label="Evening reminder" />
        </div>
        {s.eveningReminderOn && (
          <label className="onb-field onb-inline">
            <span>Remind me at</span>
            <input type="time" value={s.eveningReminderTime} onChange={(e) => updateSettings({ eveningReminderTime: e.target.value || '20:00' })} />
          </label>
        )}
        <SliderField label="Deadline reminders, days before" value={s.reminderLeadDays} min={1} max={14} suffix=" days" onChange={(n) => updateSettings({ reminderLeadDays: n })} hint="You also get one 3 days before and the day before." />
        <button
          className={notifyState === 'granted' ? 'secondary onb-cta' : 'primary onb-cta'}
          onClick={async () => setNotifyState((await ensureNotifyPermission()) ? 'granted' : 'denied')}
          disabled={notifyState === 'granted'}
        >
          <Bell size={18} /> {notifyState === 'granted' ? 'Notifications allowed' : 'Allow notifications'}
        </button>
        {notifyState === 'denied' && <p className="onb-error">Notifications are blocked. You can allow them later in your phone’s settings.</p>}
      </>
    )
  } else if (tourIdx >= 0) {
    const c = TOUR[tourIdx]
    const Icon = c.icon
    body = (
      <div className="onb-tour">
        <div className="onb-tour-icon" style={{ background: `${c.color}1f`, color: c.color }}><Icon size={40} /></div>
        <div className="onb-tour-tab" style={{ color: c.color }}>{c.tab}</div>
        <h2>{c.title}</h2>
        <ul className="onb-points">
          {c.points.map((p, j) => (
            <li key={j}><span style={{ background: c.color }} /><div>{p}</div></li>
          ))}
        </ul>
      </div>
    )
  } else {
    body = (
      <div className="onb-welcome">
        <div className="onb-logo done" aria-hidden><CheckCircle2 size={44} /></div>
        <h1>You’re all set</h1>
        <ul className="onb-summary">
          <li><span>Semester</span><b>{s.semesterStart && s.semesterEnd ? `${formatShort(s.semesterStart)} – ${formatShort(s.semesterEnd, true)}` : 'Not set — add it in Settings'}</b></li>
          <li><span>Class</span><b>{s.myBatch || 'Not chosen'}</b></li>
          <li><span>Target</span><b>{s.threshold}%</b></li>
          <li><span>Counting</span><b>{s.ignorePastAttendance ? 'From today' : `Whole semester (${s.assumedPastAttendance}% assumed)`}</b></li>
        </ul>
        <p className="onb-sub">Next: add your timetable so your classes appear on Today and the Calendar.</p>
        <button className="primary onb-cta" onClick={() => finish('timetable')}><CalendarRange size={18} /> Import my timetable</button>
        <button className="secondary onb-cta" onClick={() => finish('today')}>Go to Today</button>
        <p className="onb-note"><Settings2 size={13} /> Replay this tour any time from Settings → Appearance.</p>
      </div>
    )
  }

  return (
    <div
      className="onb"
      role="dialog"
      aria-label="Welcome tour"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return
        const dx = e.changedTouches[0].clientX - touchX
        setTouchX(null)
        const tag = (e.target as HTMLElement).tagName
        if (Math.abs(dx) < 80 || tag === 'INPUT') return
        if (dx < 0 && i < STEPS.length - 1 && canContinue) next()
        else if (dx > 0 && i > 0) back()
      }}
    >
      <header className="onb-top">
        {i > 0 ? (
          <button className="onb-back" onClick={back} aria-label="Back"><ChevronLeft size={22} /></button>
        ) : <span className="onb-back" />}
        <div className="onb-progress" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          <span style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
        </div>
        {step !== 'done' ? <button className="onb-skip" onClick={() => finish('today')}>Skip</button> : <span className="onb-skip" />}
      </header>
      {label && <div className="onb-step-label">{label}</div>}
      <main className="onb-body" key={i}>{body}</main>
      {step !== 'done' && (
        <footer className="onb-foot">
          <button className="primary onb-next" onClick={next} disabled={!canContinue}>
            {step === 'welcome' ? 'Get started' : 'Continue'}
          </button>
        </footer>
      )}
    </div>
  )
}
