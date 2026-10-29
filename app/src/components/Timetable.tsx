// Timetable tab — hand entry (A10), subjects created from them (A6),
// weekly repeat (A7), edit/remove from today onward (A8).
// Batch rule: each class can be tagged with a batch (A1/A2/A3…); untagged = whole class.
// The weekly grid shows only your batch's classes + whole-class ones (Settings → Class & batch).

import { useState } from 'react'
import { useApp } from '../data/store'
import type { ClassType } from '../data/model'
import { newId, slotMatchesBatch } from '../data/model'
import { formatShort, todayStr, weekdayName } from '../logic/dates'
import { parseTimetableText, filterByBatch, entriesToSlots, distinctBatches, keepOnlyBatch } from '../logic/timetableImport'
import type { ParsedEntry } from '../logic/timetableImport'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export default function Timetable() {
  const { data, setData, addSubject, removeSubject, addSlot, updateSlot, removeSlotFromToday } = useApp()
  const today = todayStr()
  const myBatch = data.settings.myBatch

  // ---- import flow (A1–A5) ----
  const [importOpen, setImportOpen] = useState(false);
  const [editSlotId, setEditSlotId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [editTeacher, setEditTeacher] = useState('');
  const [importText, setImportText] = useState('')
  const [parsed, setParsed] = useState<ParsedEntry[] | null>(null)
  const [allParsed, setAllParsed] = useState<ParsedEntry[]>([]) // pre-filter, for the batch prompt (A3)
  const [parseWarn, setParseWarn] = useState<string[]>([])
  const [hiddenOther, setHiddenOther] = useState(0)

  function runParse(text: string) {
    const res = parseTimetableText(text)
    setAllParsed(res.entries)
    const mine = filterByBatch(res.entries, myBatch)
    setHiddenOther(res.entries.length - mine.length)
    setParseWarn(res.warnings)
    setParsed(mine.length > 0 ? mine : res.entries)
  }

  // A3: if the pasted timetable contains batches and none is chosen yet, ask now.
  const importBatches = parsed && !myBatch ? distinctBatches(allParsed) : []

  function chooseImportBatch(b: string) {
    setData((d) => ({ ...d, settings: { ...d.settings, myBatch: b } }))
    const kept = keepOnlyBatch(allParsed, b)
    setHiddenOther(allParsed.length - kept.length)
    setParsed(kept)
  }

  async function onFilePicked(f: File | undefined) {
    if (!f) return
    let text = await f.text()
    // A1: PDFs can't be read as plain text — extract what we can instead of
    // silently failing. Ask the user to copy-paste if nothing usable comes out.
    if (f.name.toLowerCase().endsWith('.pdf') || text.startsWith('%PDF')) {
      const strings = Array.from(
        new Set(text.match(/\(([A-F][1-9]?)\)\s*[A-Z]{2,6}\s*\d{0,4}/g) ?? []),
      )
      if (strings.length >= 3) {
        setParseWarn([
          `Extracted ${strings.length} class codes from the PDF’s text layer — paste the full table (open it, Ctrl/Cmd+A → Copy) for days and times.`,
        ])
        setParsed(null)
        setAllParsed([])
        setImportText(strings.join('\n'))
        return
      }
      setParseWarn(['This PDF has no readable text layer. Open it, press Ctrl/Cmd+A → Copy, then paste here.'])
      setParsed(null)
      return
    }
    setImportText(text)
    runParse(text)
  }

  function confirmImport() {
    if (!parsed) return
    setData((d) => {
      // A6: subjects are created from the confirmed timetable.
      const subjects = [...d.subjects]
      const byShort = new Map(subjects.map((s) => [s.shortName.toUpperCase(), s.id]))
      for (const e of parsed) {
        const key = e.subjectShort.toUpperCase()
        if (!byShort.has(key)) {
          const subj = { id: newId('subj'), shortName: key, fullName: key, nicknames: [] }
          subjects.push(subj)
          byShort.set(key, subj.id)
        }
      }
      const { slots, unmatched } = entriesToSlots(parsed, byShort, today)
      void unmatched // flagged ones simply aren't saved; user fixes them by hand (T9/A4)
      return { ...d, subjects, slots: [...d.slots, ...slots.map((s) => ({ ...s, id: newId('slot') }))] }
    })
    setParsed(null)
    setImportText('')
    setImportOpen(false)
  }

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
  const [batch, setBatch] = useState('')
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
        batch: batch.trim().toUpperCase() || undefined,
        validFrom: today,
        validUntil: null,
      })
    }
    setCopyDays([])
  }

  function toggleCopy(wd: number) {
    setCopyDays((c) => (c.includes(wd) ? c.filter((x) => x !== wd) : [...c, wd]))
  }

  const allActiveSlots = data.slots.filter((s) => s.validUntil === null || s.validUntil >= today)
  const activeSlots = allActiveSlots.filter((s) => slotMatchesBatch(s.batch, myBatch))
  const hiddenCount = allActiveSlots.length - activeSlots.length

  return (
    <div>
      <h1>Timetable</h1>
      <div className="card msg">
        Hand entry below. Every class repeats weekly until you change it.
        {myBatch && (
          <>
            {' '}Showing batch <b>{myBatch}</b> + whole-class items
            {hiddenCount > 0 ? ` · ${hiddenCount} other-batch class${hiddenCount === 1 ? '' : 'es'} hidden` : ''}.
          </>
        )}
      </div>

      {/* ---- Import timetable (A1–A5) ---- */}
      {!importOpen ? (
        <button className="primary" style={{ marginBottom: 12 }} onClick={() => setImportOpen(true)}>
          Import from file / paste
        </button>
      ) : (
        <div className="card">
          <b>Import your timetable</b>
          <div className="msg" style={{ margin: '6px 0' }}>
            Upload a .txt/.csv/PDF export, or open the PDF, press Ctrl/Cmd+A → Copy, and paste below.
            {myBatch ? ` Only batch ${myBatch} + whole-class rows will be kept.` : ' Set your batch in Settings to filter batches.'}
          </div>
          <input
            type="file"
            accept=".txt,.csv,application/pdf,.pdf,text/plain,text/csv"
            onChange={(e) => onFilePicked(e.target.files?.[0])}
          />
          <textarea
            rows={6}
            style={{ width: '100%', marginTop: 8 }}
            placeholder={'Monday\t08:00-09:00\tA1 FE (P) PS 2408 …\nor CSV: Monday,08:00,09:00,A1,FE,P,PS,2408'}
            value={importText}
            onChange={(e) => { setImportText(e.target.value); runParse(e.target.value) }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => { setParsed(null); setImportOpen(false) }}>Cancel</button>
            <button className="secondary" onClick={() => runParse(importText)}>Preview</button>
          </div>

          {parseWarn.map((w, i) => (
            <div key={i} className="msg" style={{ marginTop: 8, color: 'var(--danger)' }}>{w}</div>
          ))}

          {parsed && parsed.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Review before saving (nothing saved yet)</h3>
              {importBatches.length > 0 && (
                <div className="card msg" style={{ marginTop: 6 }}>
                  Which batch is yours? Pick it to keep only your classes.
                  <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                    {importBatches.map((b) => (
                      <button key={b} className="chip" onClick={() => chooseImportBatch(b)}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {hiddenOther > 0 && (
                <div className="msg">{hiddenOther} class entries from other batches were hidden.</div>
              )}
              {WEEKDAYS.filter((w) => w !== 7).map((w) => {
                const dayEntries = parsed
                  .filter((e) => e.weekday === w)
                  .sort((a, b) => a.startTime.localeCompare(b.startTime))
                if (dayEntries.length === 0) return null
                return (
                  <div key={w} className="card" style={{ marginTop: 6 }}>
                    <b>{weekdayName(w)}</b>
                    {dayEntries.map((e) => (
                      <div className="row spread" key={`${e.weekday}_${e.startTime}_${e.batch ?? ''}_${e.subjectShort}`} style={{ marginTop: 4 }}>
                        <span className="msg">
                          {e.startTime || '--:--'} {e.batch ? `${e.batch} ` : ''}
                          <b style={{ color: 'var(--text)' }}>{e.subjectShort}</b> ({e.type}){' '}
                          {e.teacher}{e.room ? ` · ${e.room}` : ''}
                          {e.needsReview ? ' ⚠️' : ''}
                        </span>
                        <button
                          onClick={() => setParsed(parsed.filter((x) => x !== e))}
                          aria-label="Remove this entry"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary grow" onClick={confirmImport}>
                  Confirm &amp; save {parsed.length} classes
                </button>
              </div>
            </>
          )}
        </div>
      )}

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

        <div className="field-row">
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

        <label>Batch (leave empty = whole class)</label>
        <input
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          placeholder={data.settings.myBatch || 'A1'}
        />

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
                      {s.batch ? ` · ${s.batch}` : ''}
                      {s.room ? ` · ${s.room}` : ''}
                      {s.validUntil && s.validUntil !== null && s.validUntil <= today
                        ? ` · ends ${formatShort(s.validUntil)}`
                        : ''}
                    </span>
                  </span>
                  {editSlotId === s.id ? (
                    <div className="edit-form card" style={{ marginTop: 6 }}>
                      <div className="field-row">
                        <label>Start</label>
                        <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} />
                        <label>End</label>
                        <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
                      </div>
                      <div className="field-row">
                        <label>Room</label>
                        <input value={editRoom} onChange={e => setEditRoom(e.target.value)} placeholder="B-204" />
                        <label>Teacher</label>
                        <input value={editTeacher} onChange={e => setEditTeacher(e.target.value)} placeholder="Prof X" />
                      </div>
                      <button className="primary" onClick={() => {
                        // End current slot today and add new slot starting today
                        updateSlot(s.id, { validUntil: today });
                        addSlot({
                          subjectId: s.subjectId,
                          weekday: s.weekday,
                          startTime: editStart,
                          endTime: editEnd,
                          type: s.type,
                          room: editRoom.trim(),
                          teacher: editTeacher.trim(),
                          batch: s.batch,
                          validFrom: today,
                          validUntil: null,
                        });
                        setEditSlotId(null);
                      }}>Save</button>
                      <button className="secondary" onClick={() => setEditSlotId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => {
                        setEditSlotId(s.id);
                        setEditStart(s.startTime);
                        setEditEnd(s.endTime);
                        setEditRoom(s.room);
                        setEditTeacher(s.teacher);
                      }}>Edit</button>
                      <button onClick={() => removeSlotFromToday(s.id, today)}>Remove</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
