// ============================================================
// Timetable file reader (doc A1–A5, T1–T9 + batch rule).
// Reads pasted/exported timetable text (PDF "Select all → copy", or a
// .txt/.csv export) and turns it into Slot drafts for the review screen.
// Nothing is saved until the user confirms on the review screen (A4/A5).
//
// Batch rule (user requirement): entries may be prefixed with a batch tag
// like "A1 FE (P) PS 2408" — only your batch's tagged classes plus untagged
// (whole-class) ones are kept when imported (doc T8 asks first; we read the
// batch from Settings → Class & batch instead).
// ============================================================

import type { ClassType, DateStr, Slot } from '../data/model'
import { parseBatchTag } from '../data/model'

export interface ParsedEntry {
  /** Raw line the entry came from (for the review screen). */
  raw: string
  batch?: string
  subjectShort: string
  fullNameHint?: string
  type: ClassType
  teacher: string
  room: string
  /** 1 = Monday … 6 = Saturday (never Sunday here). */
  weekday: number
  startTime: string
  endTime: string
  /** True when something didn't fully match the rules → flagged for fixing (T9). */
  needsReview: boolean
  note?: string
}

const WEEKDAY_NAMES = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

/** Map the header day of a text column to a weekday number 1..7. */
export function weekdayFromName(name: string): number | null {
  const n = name.trim().toLowerCase()
  const i = WEEKDAY_NAMES.findIndex((w) => n.startsWith(w.slice(0, 3)))
  return i >= 0 ? i + 1 : null
}

/** "8:00 - 9:00", "11.15 – 12.15", "1.15 - 2.15" → ["08:00","09:00"]. */
export function parseTimeRange(text: string): [string, string] | null {
  const m = /(\d{1,2})[.:](\d{2})?\s*[-–—]\s*(\d{1,2})[.:](\d{2})?/.exec(text)
  if (!m) return null
  const h1 = Number(m[1]), m1 = m[2] ? Number(m[2]) : 0
  const h2 = Number(m[3]), m2 = m[4] ? Number(m[4]) : 0
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null
  const fmt = (h: number, mi: number) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  // "2:15 - 3:15" after lunch is afternoon; ranges never cross midnight here.
  return [fmt(h1, m1), fmt(h2, m2)]
}

/** Course-type letter per the college note: L-lecture, P-practical(lab), T-tutorial, S-studio. */
export function typeFromLetter(letter: string): ClassType | null {
  switch (letter.toUpperCase()) {
    case 'L': return 'lecture'
    case 'P': return 'lab'
    case 'T': return 'tutorial'
    case 'S': return 'tutorial' // studio treated as tutorial-style session
    default: return null
  }
}

// Entry inside one cell, e.g. "A1 FE (P) PS 2408" or "ASEP(P)" or "A CP (L) KRP 2407".
// The batch group may be a bare division letter ("A ") or a letter+digit ("A1 ").
const ENTRY_RE =
  /^(?:(?<batch>[A-E](?:[1-9])?)[.\s-]+)?(?<subj>[A-Z][A-Z0-9]*(?:-[IVX]+)?)\s*\((?<type>[LPTS])\)\s*(?:(?<teacher>[A-Z]{2,4})(?:\s+(?<room>\d{3,4}))?)?/

/** Parse every class entry inside one timetable cell (cells can stack several batches). */
export function parseCellEntries(cell: string, rawLine: string): ParsedEntry[] {
  const out: ParsedEntry[] = []
  // Split on boundaries where a new BATCH(+num)/division + SUBJECT pair starts.
  const parts = cell
    .split(/(?=(?:[A-E][1-9]?[.\s-]+)[A-Z][A-Z0-9]*(?:-[IVX]+)?\s*\()/g)
    .map((p) => p.trim())
    .filter(Boolean)
  for (const part of parts) {
    const m = ENTRY_RE.exec(part.replace(/\s+/g, ' ').trim())
    if (!m || !m.groups) {
      out.push({
        raw: rawLine, subjectShort: part.slice(0, 8), type: 'lecture', teacher: '', room: '',
        weekday: 0, startTime: '', endTime: '', needsReview: true, note: `Couldn’t read “${part}”`,
      })
      continue
    }
    const type = typeFromLetter(m.groups.type ?? 'L') ?? 'lecture'
    // A bare division letter tag ("A") means the whole class — store it so it
    // stays visible for everyone in that division; digits mean one batch.
    const batchTag = m.groups.batch?.toUpperCase()
    const isWholeClass = batchTag !== undefined && batchTag.length === 1
    out.push({
      raw: rawLine,
      batch: isWholeClass ? undefined : batchTag,
      subjectShort: m.groups.subj!.toUpperCase(),
      type,
      teacher: m.groups.teacher ?? '',
      room: m.groups.room ?? '',
      weekday: 0, startTime: '', endTime: '',
      needsReview: false,
    })
  }
  return out
}

/** Full-line parser for exported CSV-ish rows:
 *  "Monday,08:00,09:00,A1,FE,P,PS,2408" style lines pass through parseCsvLine. */
export function parseCsvLine(line: string): ParsedEntry | null {
  const cols = line.split(/[,;\t]/).map((c) => c.trim()).filter((c) => c !== '')
  if (cols.length < 4) return null
  const wd = weekdayFromName(cols[0])
  if (!wd) return null
  const start = /^\d{1,2}[.:]\d{2}$/.test(cols[1]) ? cols[1].replace('.', ':') : ''
  const end = /^\d{1,2}[.:]\d{2}$/.test(cols[2]) ? cols[2].replace('.', ':') : ''
  let batch: string | undefined
  let subj = ''
  let type: ClassType = 'lecture'
  let teacher = ''
  let room = ''
  const rest = cols.slice(3)
  for (const c of rest) {
    if (/^[A-E][1-9]$/.test(c) && !subj) { batch = c; continue }
    if (/^[LPTS]$/.test(c)) { type = typeFromLetter(c) ?? 'lecture'; continue }
    if (/^\d{3,4}$/.test(c)) { room = c; continue }
    if (/^[A-Z]{2,4}$/.test(c) && subj) { teacher = c; continue }
    if (!subj) { subj = c.toUpperCase(); continue }
  }
  if (!subj) return null
  return { raw: line, batch, subjectShort: subj, type, teacher, room,
    weekday: wd, startTime: start.padEnd(5, '0').slice(0, 5), endTime: end.padEnd(5, '0').slice(0, 5),
    needsReview: !start || !end }
}

/** Drop break/lunch rows (T8 of doc: break & lunch rows are dropped). */
function isBreakRow(line: string): boolean {
  const l = line.toLowerCase()
  return /short break|lunch|tea break|break\b/.test(l) && !/\(\s*[LPTS]\s*\)/.test(l)
}

/** Extract time headers ("8:00 - 9:00") that open a row of cells. */
function leadingTime(row: string): [string, string] | null {
  return parseTimeRange(row.slice(0, 40))
}

export interface ImportResult {
  entries: ParsedEntry[]
  /** Subjects seen, short-name → suggested full name (from abbreviation legend). */
  subjects: { short: string; full: string }[]
  warnings: string[]
}

/**
 * Main entry point: paste/exported timetable text → parsed entries.
 * Handles both grid-style text (time in first column, days across) and CSV rows.
 */
export function parseTimetableText(text: string): ImportResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const entries: ParsedEntry[] = []
  const warnings: string[] = []

  // --- Day columns: find a header row listing weekdays ---
  let dayColumns: number[] | null = null
  for (const line of lines) {
    const tokens = line.split(/\s{2,}|[\t|]/).map((t) => t.trim()).filter(Boolean)
    if (tokens.length >= 4) {
      const idxs = tokens.map((t) => weekdayFromName(t))
      if (idxs.filter((x) => x !== null).length >= 4) {
        // remember which token positions were days (approximate widths later)
        dayColumns = idxs.map((v, i) => (v === null ? -1 : i))
        break
      }
    }
  }

  // Pass 1: CSV-style lines (weekday,start,end,...)
  let csvHits = 0
  for (const line of lines) {
    if (/^\s*[A-Za-z]+\s*[,;\t]/.test(line)) {
      const wd = weekdayFromName(line.split(/[,;\t]/)[0])
      if (wd) {
        const e = parseCsvLine(line)
        if (e) { entries.push(e); csvHits++; continue }
      }
    }
  }

  // Pass 2: grid-style rows (only if CSV found nothing)
  if (csvHits === 0 && dayColumns) {
    for (const line of lines) {
      if (isBreakRow(line)) continue
      const range = leadingTime(line)
      if (!range) continue
      // Cells: split the remainder after the time header by 2+ spaces / pipes / tabs.
      const afterTime = line.slice(line.indexOf(range[0]) + `${range[0]} - ${range[1]}`.length - 1)
      const cells = afterTime.split(/\s{2,}|\t+|\|+/).map((c) => c.trim()).filter(Boolean)
      // Best-effort: map cells to Mon→Sat in order.
      const dayOrder = [1, 2, 3, 4, 5, 6]
      cells.forEach((cell, i) => {
        if (i >= dayOrder.length) return
        const parsed = parseCellEntries(cell, line)
        for (const p of parsed) {
          p.weekday = dayOrder[i]
          p.startTime = range[0]
          p.endTime = range[1]
          entries.push(p)
        }
      })
    }
  } else if (csvHits === 0 && !dayColumns) {
    warnings.push("Couldn’t find weekday columns or time rows in the text — paste the table as text (select-all + copy from the PDF) or use CSV rows like “Monday,08:00,09:00,A1,FE,P,PS,2408”.")
  }

  // --- Abbreviation legend: "SDC Statistics and Differential Calculus" pairs ---
  const fullNames = new Map<string, string>()
  const legendRe = /\b([A-Z]{2,5}(?:-[IVX]+)?)\s*\n?\s*([A-Z][A-Za-z ,&/-]{6,60})/g
  let lm: RegExpExecArray | null
  while ((lm = legendRe.exec(text))) {
    const short = lm[1]
    const full = lm[2].trim().replace(/\s+/g, ' ')
    if (!fullNames.has(short) && /^[A-Z][a-zA-Z ]+$/.test(full)) fullNames.set(short, full)
  }

  // Teacher initials → names map from legend lines like "Prachiti Suryavanshi".
  const deduped: ParsedEntry[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (e.needsReview && !e.subjectShort) continue
    const key = `${e.batch ?? ''}|${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }

  return {
    entries: deduped,
    subjects: [...fullNames.entries()].map(([short, full]) => ({ short, full })),
    warnings,
  }
}

/** Keep only whole-class entries and my batch's (untagged = everyone). */
export function filterByBatch(entries: ParsedEntry[], myBatch: string): ParsedEntry[] {
  if (!myBatch) return entries
  const me = parseBatchTag(myBatch)
  if (!me) return entries
  return entries.filter((e) => {
    if (!e.batch) return true
    const b = parseBatchTag(e.batch)
    if (!b) return true
    if (b.div !== me.div) return false
    return b.num === null || me.num === null || b.num === me.num
  })
}

/** Turn confirmed review entries into Slots (subjects must already exist by short name). */
export function entriesToSlots(
  entries: ParsedEntry[],
  subjectIdByShort: Map<string, string>,
  validFrom: DateStr,
): { slots: Omit<Slot, 'id'>[]; unmatched: ParsedEntry[] } {
  const slots: Omit<Slot, 'id'>[] = []
  const unmatched: ParsedEntry[] = []
  for (const e of entries) {
    const subjectId = subjectIdByShort.get(e.subjectShort.toUpperCase())
    if (!subjectId || !e.weekday || !e.startTime) { unmatched.push(e); continue }
    slots.push({
      subjectId,
      weekday: e.weekday,
      startTime: e.startTime,
      endTime: e.endTime || e.startTime,
      type: e.type,
      room: e.room,
      teacher: e.teacher,
      batch: e.batch,
      validFrom,
      validUntil: null,
    })
  }
  return { slots, unmatched }
}
