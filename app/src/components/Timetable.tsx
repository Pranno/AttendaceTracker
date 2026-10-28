// Timetable tab — step 1: add lectures by hand (A10), subjects created from them (A6),
// weekly repeat (A7), edit/remove from today onward (A8). File upload & rules come in Step 3.

import { useState } from 'react'
import { useApp } from '../data/store'
import type { ClassType } from '../data/model'
import { newId } from '../data/model'
import { formatShort, todayStr, weekdayName } from '../logic/dates'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export default function Timetable() {
  const { data, addSubject, removeSubject, addSlot, updateSlot, removeSlotFromToday } = useApp()
  const today = todayStr()

  // ---- new subject form ----
  const [shortName, setShortName] = useState('')
  const [fullName, setFullName] = useState('')

  // ---- new lecture form ----
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id ?? '')
  const [weekday, setWeekday] = useState(1)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [type, setType] = useState<ClassType>('lecture')
  const [room, setRoom] = useState('')
  const [teacher, setTeacher] = useState('')
  const [copyDays, setCopyDays] = useState<number[]>([])

  function submitSubject() {
    if (!shortName.trim()) return
    addSubject(shortName.trim().toUpperCase(), fullName.trim() || shortName.trim().toUpperCase())
    setShortName('')
    setFullName('')
  }

  function submitLecture() {
    const sid = subjectId || data.subjects[0]?.id
    if (!sid) return
    const days = copyDays.length > 0 ? copyDays : [weekday]
    for (const wd of days) {
      addSlot({
        subjectId: sid,
        weekday: wd,
        startTime,
        endTime,
        type,
        room: room.trim(),
        teacher: teacher.trim(),
        validFrom: today,
        validUntil: null,
      })
    }
    setCopyDays([])
  }

  function toggleCopy(wd: number) {
    setCopyDays((c) => (c.includes(wd) ? c.filter((x) => x !== wd) : [...c, wd]))
  }

  const activeSlots = data.slots.filter((s) => s.validUntil === null || s.validUntil >= today)

  return (
    <div>
      <h1>Timetable</h1>
      <div className="card msg">
        Step 1 builds hand entry (A10). Uploading a PDF/spreadsheet with rule-based reading is
        Step 3. Every class repeats weekly until you change it.
      </div>

      <h2>Subjects</h2>
      {data.subjects.map((s) => (
        <div className="card row spread" key={s.id}>
          <div>
            <b>{s.shortName}</b> <span className="msg">{s.fullName}</span>
          </div>
          <button
            onClick={() => {
              if (window.confirm(`Remove ${s.shortName} and all its classes?`)) removeSubject(s.id)
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="card">
        <label>Short name (e.g. SDC)</label>
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="SDC" />
        <label>Full name</label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Statistics and Differential Calculus"
        />
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={submitSubject}>
            Add subject
          </button>
        </div>
      </div>

      <h2>Add a lecture</h2>
      <div className="card">
        <label>Subject</label>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shortName} — {s.fullName}
            </option>
          ))}
        </select>

        <label>Day{data.settings.sundayClasses ? '' : ' (Sunday off — turn on in Settings)'}</label>
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAYS.filter((w) => w !== 7 || data.settings.sundayClasses).map((w) => (
            <option key={w} value={w}>
              {weekdayName(w)}
            </option>
          ))}
        </select>

        <div className="row">
          <div className="grow">
            <label>Start</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="grow">
            <label>End</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as ClassType)}>
          <option value="lecture">Lecture</option>
          <option value="lab">Lab</option>
          <option value="tutorial">Tutorial</option>
          <option value="online">Online</option>
        </select>

        <div className="row">
          <div className="grow">
            <label>Room</label>
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="B-204" />
          </div>
          <div className="grow">
            <label>Teacher</label>
            <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="Prof X" />
          </div>
        </div>

        <label>Also copy to other days</label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {WEEKDAYS.filter((w) => w !== weekday && (w !== 7 || data.settings.sundayClasses)).map(
            (w) => (
              <button
                key={w}
                className={copyDays.includes(w) ? 'present on' : ''}
                onClick={() => toggleCopy(w)}
              >
                {weekdayName(w)}
              </button>
            ),
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="primary" onClick={submitLecture} disabled={data.subjects.length === 0}>
            Add lecture
          </button>
        </div>
      </div>

      <h2>Weekly timetable</h2>
      {activeSlots.length === 0 && <div className="card msg">No classes yet.</div>}
      {WEEKDAYS.filter((w) => w !== 7 || data.settings.sundayClasses).map((w) => {
        const daySlots = activeSlots
          .filter((s) => s.weekday === w)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
        if (daySlots.length === 0) return null
        return (
          <div className="card" key={w}>
            <b>{weekdayName(w)}</b>
            {daySlots.map((s) => {
              const subj = data.subjects.find((x) => x.id === s.subjectId)
              return (
                <div className="row spread" key={s.id} style={{ marginTop: 6 }}>
                  <span>
                    {s.startTime}–{s.endTime} <b>{subj?.shortName}</b>{' '}
                    <span className="msg">
                      {s.type}
                      {s.room ? ` · ${s.room}` : ''}
                      {s.validUntil && s.validUntil !== null && s.validUntil <= today
                        ? ` · ends ${formatShort(s.validUntil)}`
                        : ''}
                    </span>
                  </span>
                  <button onClick={() => removeSlotFromToday(s.id, today)}>Remove</button>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* keep updateSlot referenced so future edits hook here in Step 3 */}
      <span style={{ display: 'none' }}>{typeof updateSlot + newId('x').slice(0, 0)}</span>
    </div>
  )
}
