// Calendar screen (Step 2 look, full day-editing arrives Step 4): a large
// rounded month card. Today is a gradient circle; subject-coloured dots mark
// classes, highlight dots mark deadlines. Tapping a date opens a bottom sheet
// with that day's classes (markable) and deadlines.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../data/store'
import type { DateStr, MarkStatus } from '../data/model'
import { slotsForDate, isHoliday, markFor } from '../logic/attendance'
import { toDate, todayStr, pad2 } from '../logic/dates'
import { Sheet, SectionTitle } from './ui/parts'
import { subjectPalette } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export default function Calendar() {
  const { data, setMark } = useApp()
  const { active } = useTheme()
  const today = todayStr()
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = toDate(today)
    return { y: d.getFullYear(), m: d.getMonth() } // m: 0-11
  })
  const [openDate, setOpenDate] = useState<DateStr | null>(null)

  const cells = useMemo(() => {
    const first = new Date(monthAnchor.y, monthAnchor.m, 1)
    // Monday-first grid offset
    const lead = (first.getDay() + 6) % 7
    const daysInMonth = new Date(monthAnchor.y, monthAnchor.m + 1, 0).getDate()
    const out: (DateStr | null)[] = []
    for (let i = 0; i < lead; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${monthAnchor.y}-${pad2(monthAnchor.m + 1)}-${pad2(d)}`)
    }
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [monthAnchor])

  function shiftMonth(n: number) {
    setMonthAnchor((a) => {
      const d = new Date(a.y, a.m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  const subjIndex = (id: string) => Math.max(0, data.subjects.findIndex((s) => s.id === id))

  function dotsFor(date: DateStr): string[] {
    const colors: string[] = []
    if (!isHoliday(data, date)) {
      for (const slot of slotsForDate(data, date)) {
        const pal = subjectPalette(subjIndex(slot.subjectId))
        const c = active === 'midnight' ? pal.strong : pal.strong
        if (!colors.includes(c)) colors.push(c)
      }
    } else {
      colors.push('var(--soft)')
    }
    for (const dl of data.deadlines) {
      if (dl.dueDate === date && !dl.done) colors.push('var(--highlight)')
    }
    return colors.slice(0, 4)
  }

  const monthName = new Date(monthAnchor.y, monthAnchor.m, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  const daySlots = openDate
    ? isHoliday(data, openDate)
      ? []
      : slotsForDate(data, openDate).sort((a, b) => a.startTime.localeCompare(b.startTime))
    : []
  const dayDeadlines = openDate ? data.deadlines.filter((d) => d.dueDate === openDate) : []

  function mark(slotId: string, status: MarkStatus | null) {
    if (!openDate) return
    setMark(openDate, slotId, status)
    navigator.vibrate?.(10)
  }

  return (
    <div className="screen pad">
      <h1 style={{ margin: '8px 0 12px' }}>Calendar</h1>
      <div className="card cal-card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <b style={{ fontSize: 18 }}>{monthName}</b>
          <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="cal-head">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <span key={d} className="small-label">{d}</span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} />
            const isToday = date === today
            const dayNum = toDate(date).getDate()
            return (
              <button
                key={date}
                className={`cal-day ${isToday ? 'today' : ''}`}
                onClick={() => setOpenDate(date)}
                aria-label={date}
              >
                <span className={`num ${isToday ? 'today-num' : ''}`}>{dayNum}</span>
                <span className="cal-dots">
                  {dotsFor(date).map((c, j) => (
                    <i key={j} style={{ background: c }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <SectionTitle>LEGEND</SectionTitle>
      <div className="card row" style={{ flexWrap: 'wrap', gap: 10 }}>
        {data.subjects.map((s, i) => (
          <span key={s.id} className="row" style={{ gap: 4 }}>
            <i style={{ width: 10, height: 10, borderRadius: 99, background: subjectPalette(i).strong, display: 'inline-block' }} />
            <span className="msg">{s.shortName}</span>
          </span>
        ))}
        <span className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--highlight)', display: 'inline-block' }} />
          <span className="msg">Deadline</span>
        </span>
      </div>

      <Sheet open={openDate !== null} onClose={() => setOpenDate(null)} title={openDate ?? ''}>
        {openDate && (
          <div>
            {isHoliday(data, openDate) && <div className="card empty-card">🎉 Holiday — no classes.</div>}
            {openDate && daySlots.length === 0 && !isHoliday(data, openDate) && (
              <div className="card empty-card">No classes on this day.</div>
            )}
            {daySlots.map((slot) => {
              const subj = data.subjects.find((s) => s.id === slot.subjectId)
              const status = openDate ? markFor(data, openDate, slot.id) : null
              const idx = subjIndex(slot.subjectId)
              const dark = active === 'midnight'
              const pal = subjectPalette(idx)
              return (
                <div
                  className="class-card card-like"
                  key={slot.id}
                  style={{ background: dark ? `color-mix(in srgb, ${pal.strong} 25%, #2A1E3A)` : pal.softBg }}
                >
                  <b style={{ color: pal.strong }}>{subj?.shortName}</b>
                  <div className="class-meta">
                    {slot.startTime}–{slot.endTime} · {slot.type}
                  </div>
                  <div className="row mark-row">
                    <button className={`mark present ${status === 'present' ? 'on' : ''}`} onClick={() => mark(slot.id, status === 'present' ? null : 'present')}>Present</button>
                    <button className={`mark absent ${status === 'absent' ? 'on' : ''}`} onClick={() => mark(slot.id, status === 'absent' ? null : 'absent')}>Absent</button>
                    <button className={`mark noclass ${status === 'noclass' ? 'on' : ''}`} onClick={() => mark(slot.id, status === 'noclass' ? null : 'noclass')}>No class</button>
                  </div>
                </div>
              )
            })}
            {dayDeadlines.map((dl) => (
              <div className="card row spread" key={dl.id}>
                <span>⏰ <b>{dl.title}</b></span>
                <span className="msg">{dl.done ? 'done' : 'due'}</span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}
