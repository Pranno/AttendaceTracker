// Onboarding wizard — shown once on first launch (settings.onboarded flag).
// A full-screen tour that walks through the tabs and explains what the app
// calculates and where each number comes from. Swipe left/right also moves
// between steps; the last step sends the user to Settings to set semester
// dates, which everything else depends on.

import { useState } from 'react'
import { useApp } from '../data/store'

type Step = {
  emoji: string
  title: string
  lines: string[]
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: 'Welcome to Attendance Tracker',
    lines: [
      'Everything stays on your phone — no account, no cloud.',
      'You mark classes, the app does all the maths: attendance %, skip budgets and warnings.',
      'Swipe left (or tap Next) to see what lives where.',
    ],
  },
  {
    emoji: '📅',
    title: 'Today — your day at a glance',
    lines: [
      'Your everyday lectures for the selected day, in time order.',
      'Tap Present / Absent / Cancel next to a class to mark it.',
      'The coloured ring shows how close each subject is to your minimum percentage.',
      'Swipe the day strip at the top to move through the week.',
    ],
  },
  {
    emoji: '📚',
    title: 'Subjects — your courses & attendance',
    lines: [
      'One card per subject: attended ÷ held, current percentage and how many classes you can safely skip (or must attend) to stay above your target.',
      'Add subjects by hand or import them with the timetable.',
      'Type real totals from the college ERP any time — they replace the calculated figures.',
    ],
  },
  {
    emoji: '🗓️',
    title: 'Timetable — weekly grid',
    lines: [
      'Import your timetable as PDF/CSV, or build it manually.',
      'Each lecture gets a day, time, room, teacher and optional batch tag.',
      'Classes you add here automatically appear on Today and the Calendar.',
    ],
  },
  {
    emoji: '🌐',
    title: 'Calendar — the whole semester',
    lines: [
      'Month view with every class, holiday, exam day and deadline.',
      'Tap any day to see its lectures and mark missed attendance later.',
      'Holidays hide classes; exam days are marked but still count normally.',
    ],
  },
  {
    emoji: '🎓',
    title: 'Study — plan ahead',
    lines: [
      'Monthly projection: given your remaining classes, here is what your attendance will end at if you keep going like this.',
      'Per-subject course units, internal marks and a CGPA planner live here too.',
    ],
  },
  {
    emoji: '⚙️',
    title: 'Settings — one thing first',
    lines: [
      'Set your semester start & end dates — classes only show inside that range, and the monthly plan needs both.',
      'Pick your division & batch so the timetable filters correctly.',
      'Choose your minimum attendance %, reminders and theme.',
    ],
  },
]

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { updateSettings } = useApp()
  const [i, setI] = useState(0)
  const [dx0, setDx0] = useState<number | null>(null)
  const last = i === STEPS.length - 1
  const step = STEPS[i]

  function finish() {
    updateSettings({ onboarded: true })
    onDone()
  }

  // Light swipe support between wizard steps (bigger threshold than tab swipe).
  const onTouchStart = (e: React.TouchEvent) => setDx0(e.touches[0].clientX)
  const onTouchEnd = (e: React.TouchEvent) => {
    if (dx0 === null) return
    const dx = e.changedTouches[0].clientX - dx0
    setDx0(null)
    if (Math.abs(dx) < 80) return
    if (dx < 0 && !last) setI(i + 1)
    else if (dx > 0 && i > 0) setI(i - 1)
  }

  return (
    <div className="onb-backdrop" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="onb-card" key={i}>
        <div className="onb-emoji">{step.emoji}</div>
        <h2>{step.title}</h2>
        <ul>
          {step.lines.map((l, j) => (
            <li key={j}>{l}</li>
          ))}
        </ul>
        <div className="onb-dots" aria-hidden>
          {STEPS.map((_, j) => (
            <span key={j} className={`onb-dot ${j === i ? 'on' : ''}`} onClick={() => setI(j)} />
          ))}
        </div>
        <div className="row spread" style={{ gap: 10, marginTop: 14 }}>
          {!last ? (
            <>
              <button className="secondary big-btn" onClick={finish}>Skip tour</button>
              <button className="primary big-btn grow" onClick={() => setI(i + 1)}>Next</button>
            </>
          ) : (
            <button className="primary big-btn grow" onClick={finish}>Let’s go — open Settings</button>
          )}
        </div>
      </div>
    </div>
  )
}
