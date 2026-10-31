// Timetable tab — hand entry (A10), subjects created from them (A6),
// weekly repeat (A7), edit/remove from today onward (A8).
// Batch rule: each class can be tagged with a batch (A1/A2/A3…); untagged = whole class.
// The weekly grid shows only your batch's classes + whole-class ones (Settings → Class & batch).

import { useState } from 'react'
import { useApp } from '../data/store'
import type { ClassType, DateStr } from '../data/model'
import { newId, slotMatchesBatch } from '../data/model'
import { formatShort, monthKey, todayStr, weekdayName } from '../logic/dates'
import { parseTimetableText, parseTimetablePages, filterByBatch, entriesToSlots, distinctBatches, keepOnlyBatch } from '../logic/timetableImport'
import type { GridParseResult, ImportResult, ParsedEntry } from '../logic/timetableImport'
import type { TextItemLike } from '../logic/syllabusReader'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export default function Timetable() {
  const { data, setData, addSubject, removeSubject, addSlot, deleteSlot, updateSlot } = useApp()
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
  // Legend subjects (short → full name) read from the uploaded PDF's
  // abbreviation table; used when confirming the import.
  const [legendSubjects, setLegendSubjects] = useState<{ short: string; full: string }[]>([])

  function applyParsed(res: ImportResult | GridParseResult, legend?: { short: string; full: string }[]) {
    setAllParsed(res.entries)
    const mine = filterByBatch(res.entries, myBatch)
    setHiddenOther(res.entries.length - mine.length)
    setParseWarn(res.warnings)
    setParsed(mine.length > 0 ? mine : res.entries)
    setLegendSubjects(legend ?? [])
  }

  function runParse(text: string) {
    const res = parseTimetableText(text)
    if (res.entries.length > 0 || !/\([A-F][1-9]?\)/.test(text)) {
      applyParsed(res)
      return
    }
    // The paste contains class codes but the line reader found nothing —
    // it's PDF text that lost its column layout (one cell per line).
    // Rebuild a synthetic grid from the code legend and day/time lines so
    // the positioned grid reader can still recover most of the timetable.
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const DAYNAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const timeRe = /^(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})$/
    const times = new Set<string>()
    for (const l of lines) if (timeRe.test(l)) times.add(l.replace(/\./g, ':'))
    const codeRe = /^[A-Z]{2,6}(?:-[IVX]+)?\(([LPT])\)(?:\(([A-C][1-9]?)\))?/
    const codes = new Map<string, string[]>()
    for (const l of lines) {
      const m = codeRe.exec(l)
      if (m && !codes.has(m[0])) codes.set(m[0], [])
    }
    const items: TextItemLike[] = []
    let y = 0
    const add = (x: number, s: string) => { items.push({ str: s, transform: [1, 0, 0, 1, x, --y] }); }
    DAYNAMES.forEach((d, i) => add(80 + i * 70, d))
    const tl = [...times].sort().reverse()
    for (const t of tl) {
      const tm = timeRe.exec(t)!
      add(10, `${tm[1]} - ${tm[2]}`)
      let ci = 0
      for (const key of codes.keys()) {
        add(80 + (ci % 6) * 70, key)
        ci++
      }
    }
    const grid = parseTimetablePages([items])
    if (grid.entries.length > 0) {
      applyParsed(grid, grid.subjects)
      return
    }
    applyParsed(res)
  }

  // A3: if the pasted timetable contains batches and none is chosen yet, ask now.
  const importBatches = parsed && !myBatch ? distinctBatches(allParsed) : []

  function chooseImportBatch(b: string) {
    setData((d) => ({ ...d, settings: { ...d.settings, myBatch: b } }))
    const kept = keepOnlyBatch(allParsed, b)
    setHiddenOther(allParsed.length - kept.length)
    setParsed(kept)
  }

  // True if the text looks like a grid timetable (day names + time ranges)
  // rather than PDF binary junk — used to decide whether the plain-text
  // fallback after a failed pdfjs load is worth parsing.
  function looksLikeTimetable(text: string): boolean {
    const dayRe = /^(mon|tue|wed|thu|fri|sat|sun)(day|nesday|rsday|urday)?\b/mi
    const timeRe = /\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}/
    return dayRe.test(text) && timeRe.test(text)
  }

  async function onFilePicked(f: File | undefined) {
    if (!f) return
    const nameLower = f.name.toLowerCase()
    const isPdf = nameLower.endsWith('.pdf') || nameLower.endsWith('.htm') || nameLower.endsWith('.html')
    let text = ''
    try {
      text = await f.text()
    } catch {
      text = ''
    }
    // A1: real PDFs must be read with pdfjs so every text item keeps its
    // x/y position — that's what makes the weekday-columns/time-rows grid
    // recoverable. Reading a PDF as plain text yields binary junk and used
    // to produce "Couldn't find weekday columns or time rows".
    //
    // Robustness: some browsers/extensions hand out PDF files whose *name*
    // lost the ".pdf" suffix (e.g. saved as "timetable.pdf.txt") or whose
    // MIME is mislabelled. Detect the %PDF magic bytes in the content itself
    // so those still take the positioned-grid path.
    const looksBinaryPdf = text.startsWith('%PDF') || /%PDF-\d/.test(text.slice(0, 1024))
    if (isPdf || looksBinaryPdf) {
      try {
        const pdfjs = await import('pdfjs-dist')
        // Bundle the worker locally: vite rewrites this literal import with
        // the `?url` suffix into a real file URL at build time. No CDN
        // dependency, works offline.
        // @ts-ignore -- vite-only "?url" import suffix
        const workerMod = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as string)) as unknown as { default?: string }
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default ?? ''
        const data = new Uint8Array(await f.arrayBuffer())
        // PDFs that are actually mislabeled text (HTML/print exports saved
        // with a .pdf name) have no %PDF header — parse them as text.
        if (!(data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) {
          const t = new TextDecoder().decode(data)
          setImportText(t)
          runParse(t)
          return
        }
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
        const pages: TextItemLike[][] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const tc = await page.getTextContent()
          pages.push(tc.items as unknown as TextItemLike[])
        }
        const res = parseTimetablePages(pages)
        if (res.entries.length > 0) {
          applyParsed(res, res.subjects)
          setImportText('')
          return
        }
        // Grid reader found nothing usable. Before showing a hard error,
        // give the line-based reader one chance on any readable text we
        // have (some "PDFs" are actually text exports wearing a PDF mask).
        if (looksLikeTimetable(text)) {
          const tr = parseTimetableText(text)
          if (tr.entries.length > 0) {
            applyParsed(tr)
            setImportText(text)
            return
          }
        }
        // Grid reader found nothing usable — show its warnings, or a clear
        // generic one, and stop (never silently fall into the text-paste
        // error which confuses users about what actually went wrong).
        setParseWarn(res.warnings.length
          ? res.warnings
          : ['The PDF grid could not be read. Try pasting the table as text instead (open the PDF, Ctrl/Cmd+A → Copy).'])
        setParsed(null)
        setAllParsed([])
        return
      } catch {
        // pdfjs failed (corrupt file / unsupported encoding). Last resort:
        // regex-extract class codes from whatever raw text we got.
        const strings = Array.from(
          new Set(text.match(/\(([A-F][1-9]?)\)\s*[A-Z]{2,6}\s*\d{0,4}/g) ?? []),
        )
        if (strings.length >= 3) {
          setParseWarn([
            `Extracted ${strings.length} class codes from the PDF’s text layer — paste the full table (open it, Ctrl/Cmd+A → Copy) for days and times.`,
          ])
          setParsed(null)
          setAllParsed([])
          setLegendSubjects([])
          setImportText(strings.join('\n'))
          return
        }
        if (looksLikeTimetable(text)) {
          // e.g. the user picked a .txt that starts with %PDF by mistake,
          // or an export that is actually text — give the text parser a shot.
          setImportText(text)
          runParse(text)
          return
        }
        setParseWarn(['This PDF has no readable text layer. Open it, press Ctrl/Cmd+A → Copy, then paste here.'])
        setParsed(null)
        return
      }
    }
    // Plain-text / CSV upload path. If it doesn't look like a timetable at
    // all, say so plainly instead of running the grid heuristic and showing
    // its confusing "weekday columns" message.
    if (text && !looksLikeTimetable(text) && !/\(/.test(text)) {
      setParseWarn(['That file does not look like a timetable. Upload the PDF directly, or open it and paste the table as text (Ctrl/Cmd+A → Copy).'])
      setParsed(null)
      setAllParsed([])
      setImportText(text)
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
      // Legend full names from the uploaded PDF (e.g. VACO → "Value added
      // career orientation I") — enrich existing/created subjects with them.
      const legendFull = new Map(legendSubjects.map((l) => [l.short.toUpperCase(), l.full]))
      for (const e of parsed) {
        const key = e.subjectShort.toUpperCase()
        if (!byShort.has(key)) {
          const subj = { id: newId('subj'), shortName: key, fullName: legendFull.get(key) ?? key, nicknames: [] }
          subjects.push(subj)
          byShort.set(key, subj.id)
        } else if (legendFull.has(key)) {
          const i = subjects.findIndex((s) => s.id === byShort.get(key))
          if (i >= 0 && subjects[i].fullName === subjects[i].shortName) {
            subjects[i] = { ...subjects[i], fullName: legendFull.get(key)! }
          }
        }
      }
      const { slots, unmatched } = entriesToSlots(parsed, byShort, today)
      void unmatched // flagged ones simply aren't saved; user fixes them by hand (T9/A4)
      // J2: the monthly plan starts from the month after the timetable was
      // first confirmed. Set once — re-imports later don't move it back.
      const nextMonthMk = (() => {
        const d = new Date()
        d.setDate(1)
        d.setMonth(d.getMonth() + 1)
        return monthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` as DateStr)
      })()
      return {
        ...d,
        subjects,
        slots: [...d.slots, ...slots.map((s) => ({ ...s, id: newId('slot') }))],
        settings: d.settings.planStartMonth ? d.settings : { ...d.settings, planStartMonth: nextMonthMk },
      }
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
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [type, setType] = useState<ClassType>('lecture')
  const [room, setRoom] = useState('')
  const [teacher, setTeacher] = useState('')
  const [batch, setBatch] = useState('')
  // Day chips: every highlighted day gets this lecture when you press Add.
  // Tapping a day that already has a matching lecture (added by mistake)
  // removes it right away — no need to hunt for it and delete it later.
  const [selectedDays, setSelectedDays] = useState<number[]>([1])

  function submitSubject() {
    if (!shortName.trim()) return
    addSubject(shortName.trim().toUpperCase(), fullName.trim() || shortName.trim().toUpperCase())
    setShortName('')
    setFullName('')
  }

  const enabledWeekdays = WEEKDAYS.filter((w) => w !== 7 || data.settings.sundayClasses)

  /** A slot "matches" the form when it's the same subject at the same start
   *  time on that weekday — i.e. exactly what adding would duplicate. */
  function matchingSlotOn(wd: number) {
    const sid = subjectId || data.subjects[0]?.id
    if (!sid) return undefined
    // declared below (allActiveSlots) — function declarations hoist, and this
    // only runs during render after that const has been initialised.
    return allActiveSlots.find(
      (s) => s.weekday === wd && s.subjectId === sid && s.startTime === startTime,
    )
  }

  /** Hard-remove a lecture slot. If attendance was already marked for it,
   *  ask first so the user knows those marks go too; otherwise delete
   *  instantly — no "ends on this day" half-state to clean up later. */
  function hardRemoveSlot(id: string) {
    const marked = data.marks.some((m) => m.slotId === id)
    if (marked && !window.confirm('This class has attendance you marked. Remove it and its marks?')) return
    deleteSlot(id)
  }

  function toggleDay(wd: number) {
    const existing = matchingSlotOn(wd)
    if (existing) {
      // Already has this lecture: remove it outright and drop the highlight.
      hardRemoveSlot(existing.id)
      setSelectedDays((sel) => sel.filter((x) => x !== wd))
      return
    }
    setSelectedDays((sel) => (sel.includes(wd) ? sel.filter((x) => x !== wd) : [...sel, wd]))
  }

  function submitLecture() {
    const sid = subjectId || data.subjects[0]?.id
    if (!sid || selectedDays.length === 0) return
    for (const wd of selectedDays) {
      // Skip days that already carry this class (belt & braces — the chip
      // tap normally handles those by removing instead of adding).
      if (matchingSlotOn(wd)) continue
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
  }

  const allActiveSlots = data.slots.filter((s) => s.validUntil === null || s.validUntil >= today)
  const activeSlots = allActiveSlots.filter((s) => slotMatchesBatch(s.batch, myBatch))
  const hiddenCount = allActiveSlots.length - activeSlots.length

  return (
    <div>
      {/* The Timetable tab header is rendered by App.tsx — no h1 here, or the
          section title would appear twice on screen. */}
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

        <label>Days{data.settings.sundayClasses ? '' : ' (Sunday off — turn on in Settings)'}</label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {enabledWeekdays.map((w) => {
            const has = !!matchingSlotOn(w)
            const sel = selectedDays.includes(w)
            return (
              <button
                key={w}
                className={has ? 'day-chip has on' : sel ? 'day-chip on' : 'day-chip'}
                onClick={() => toggleDay(w)}
                title={
                  has
                    ? 'This lecture already runs here — tap to remove it'
                    : sel
                      ? 'Selected — tap to deselect'
                      : 'Tap to also add this lecture here'
                }
              >
                {weekdayName(w)}
                {has ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
        <div className="msg" style={{ marginTop: 6 }}>
          Highlighted days get this lecture. A day with ✓ already has it — tap it
          to remove that copy, tap again to add it back.
        </div>

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

        <div style={{ marginTop: 12 }}>
          <button
            className="primary"
            onClick={submitLecture}
            disabled={data.subjects.length === 0 || selectedDays.length === 0}
          >
            Add lecture{selectedDays.length > 0 ? ` (${selectedDays.map(weekdayName).join(', ')})` : ''}
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
                      <button onClick={() => hardRemoveSlot(s.id)}>Remove</button>
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
