// Today screen (step-1 version): today's classes with Present / Absent / No class,
// per-subject percentages and can-miss lines, overall percentage, warnings (B1–B9).
// The full design (gradient header, hero ring, floating pill nav) comes in Step 2.

import { useMemo, useRef, useState } from 'react'
import { useApp } from '../data/store'
import type { DateStr, MarkStatus } from '../data/model'
import { buildReport, slotsForDate, isHoliday, markFor } from '../logic/attendance'
import { addDays, formatShort, todayStr } from '../logic/dates'

export default function Today() {
  const { data, setMark } = useApp()
  const [undoMsg, setUndoMsg] = useState<string | null>(null)
  const [dateOverride, setDateOverride] = useState<DateStr | null>(null)
  const undoRef = useRef<(() => void) | null>(null)

  const today = todayStr()
  const viewDate = dateOverride ?? today
  const isPast = viewDate < today

  // Range for totals: semester start (or the earliest slot validFrom) up to today.
  const rangeStart = useMemo<DateStr>(() => {
    if (data.settings.semesterStart) return data.settings.semesterStart
    if (data.slots.length === 0) return today
    return data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today)
  }, [data.settings.semesterStart, data.slots, today])

  const report = useMemo(
    () => buildReport(data, today, rangeStart, today),
    [data, today, rangeStart],
  )

  const holiday = isHoliday(data, viewDate)
  const daySlots = useMemo(() => {
    if (holiday) return []
    return slotsForDate(data, viewDate).sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [data, viewDate, holiday])

  function mark(slotId: string, status: MarkStatus) {
    const prev = markFor(data, viewDate, slotId)
    setMark(viewDate, slotId, status)
    undoRef.current = () => setMark(viewDate, slotId, prev)
    setUndoMsg(`Marked ${status === 'noclass' ? 'No class' : status}.`)
    window.setTimeout(() => setUndoMsg(null), 4000)
  }

  const overallClass = report.overall >= data.settings.threshold ? 'safe' : 'below'

  return (
    <div>
      <div className="card row spread">
        <div>
          <h1 style={{ margin: 0 }}>Today</h1>
          <div className="msg">
            {formatShort(viewDate, true)}
            {isPast ? ' · past day' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`pct ${overallClass}`}>{report.overall.toFixed(1)}%</div>
          <div className="msg">overall · target {data.settings.threshold}%</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setDateOverride(addDays(viewDate, -1))}>◀</button>
        <div className="grow msg" style={{ textAlign: 'center' }}>
          {viewDate === today ? "Today's classes" : formatShort(viewDate, true)}
        </div>
        <button
          onClick={() => setDateOverride(addDays(viewDate, 1) > today ? today : addDays(viewDate, 1))}
        >
          ▶
        </button>
        {dateOverride && (
          <button onClick={() => setDateOverride(null)}>Back to today</button>
        )}
      </div>

      {undoMsg && (
        <div className="card row spread">
          <span className="msg">{undoMsg}</span>
          <button
            onClick={() => {
              undoRef.current?.()
              setUndoMsg(null)
            }}
          >
            Undo
          </button>
        </div>
      )}

      {holiday && (
        <div className="card">
          <b>Holiday.</b>{' '}
          <span className="msg">
            {data.holidays.find(
              (h) => !h.isExamDay && viewDate >= h.startDate && viewDate <= h.endDate,
            )?.label ?? 'No class today.'}
          </span>
        </div>
      )}

      {!holiday && daySlots.length === 0 && (
        <div className="card">No classes on {formatShort(viewDate)}. Enjoy!</div>
      )}

      {!holiday &&
        daySlots.map((slot) => {
          const subj = data.subjects.find((s) => s.id === slot.subjectId)
          const status = markFor(data, viewDate, slot.id)
          return (
            <div className="card" key={slot.id}>
              <div>
                <b>{subj?.shortName}</b>{' '}
                <span className="msg">
                  {slot.startTime}–{slot.endTime} · {slot.type}
                  {slot.room ? ` · ${slot.room}` : ''}
                </span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className={`present ${status === 'present' ? 'on' : ''}`}
                  onClick={() => mark(slot.id, 'present')}
                >
                  Present
                </button>
                <button
                  className={`absent ${status === 'absent' ? 'on' : ''}`}
                  onClick={() => mark(slot.id, 'absent')}
                >
                  Absent
                </button>
                <button
                  className={`noclass ${status === 'noclass' ? 'on' : ''}`}
                  onClick={() => mark(slot.id, 'noclass')}
                >
                  No class
                </button>
              </div>
            </div>
          )
        })}

      <h2>Subjects</h2>
      {report.bySubject.length === 0 && (
        <div className="card msg">No subjects yet — add your timetable in the Timetable tab.</div>
      )}
      {report.bySubject.map((s) => (
        <div className="card" key={s.subjectId}>
          <div className="row spread">
            <div>
              <b>{s.shortName}</b>{' '}
              <span className="msg">
                {s.name} · {s.attended}/{s.held}
              </span>
            </div>
            <div
              className={`pct ${
                s.status === 'safe'
                  ? 'safe'
                  : s.status === 'limit'
                    ? 'limit'
                    : s.status === 'below'
                      ? 'below'
                      : 'msg'
              }`}
            >
              {s.held === 0 ? '—' : `${s.percent.toFixed(1)}%`}
            </div>
          </div>
          <div className="msg">{s.message}</div>
        </div>
      ))}

      {report.warnings.length > 0 && (
        <div className="card" style={{ borderLeft: '6px solid var(--danger)' }}>
          <b>Below your minimum:</b>{' '}
          <span className="msg">
            {report.warnings.map((w) => `${w.shortName} (${w.percent.toFixed(1)}%)`).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}
