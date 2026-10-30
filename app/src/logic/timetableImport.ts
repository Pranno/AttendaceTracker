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
// The PDF splits "(P)" into "(" + "P" + ")" sometimes and glues the type to the
// next word sometimes ("(L)PS"), so all three spellings are accepted.
const TYPE_TOK = String.raw`\(\s*[LPTS]\s*\)|\([LPTS][A-Za-z(]|\(\s+[LPTS]\s+\)`
const ENTRY_RE = new RegExp(
  String.raw`^(?:(?<batch>[A-E](?:[1-9])?)[.\s-]+)?(?<subj>[A-Z][A-Z0-9]*(?:-[IVX]+)?)\s*` +
    `(?<typeTok>${TYPE_TOK})\\s*(?:(?<teacher>[A-Z][A-Za-z0-9]{1,3})(?:\\s+(?<room>\\d{3,4}))?)?`,
)
/** The course-type letter out of whichever spelling of "(P)" was matched. */
function typeLetterOf(typeTok: string | undefined): string | undefined {
  if (!typeTok) return undefined
  const m = /\(\s*([LPTS])/i.exec(typeTok)
  return m ? m[1].toUpperCase() : undefined
}

/** Normalise the PDF's broken-up spellings of the course-type marker:
 *  "( L )" → "(L)", and a type glued to the following word ("(L)PS") gets a
 *  space so the teacher/room tokens stay readable. */
function normalizeTypeTok(text: string): string {
  return text
    .replace(/\(\s+([LPTS])\s+\)/g, '($1)')
    .replace(/\(\s*([LPTS])\s*\)/g, '($1)')
    .replace(/\(([LPTS])(?=[A-Za-z(])/g, '($1) ')
}

/** Parse every class entry inside one timetable cell (cells can stack several batches). */
export function parseCellEntries(cell: string, rawLine: string): ParsedEntry[] {
  const out: ParsedEntry[] = []
  const norm = normalizeTypeTok(cell.replace(/\s+/g, ' ').trim())
  // Split on boundaries where a new BATCH(+num)/division + SUBJECT pair starts.
  const parts = norm
    .split(new RegExp(`(?=(?:[A-E][1-9]?[.\\s-]+)[A-Z][A-Z0-9]*(?:-[IVX]+)?\\s*${TYPE_TOK})`))
    .map((p) => p.trim())
    .filter(Boolean)
  for (const part of parts) {
    const m = ENTRY_RE.exec(part)
    if (!m || !m.groups) {
      out.push({
        raw: rawLine, subjectShort: part.slice(0, 8), type: 'lecture', teacher: '', room: '',
        weekday: 0, startTime: '', endTime: '', needsReview: true, note: `Couldn’t read “${part}”`,
      })
      continue
    }
    const type = typeFromLetter(typeLetterOf(m.groups.typeTok) ?? 'L') ?? 'lecture'
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

/** Batch tags found in the parsed text, sorted (e.g. ["A1", "A2", "A3"]). */
export function distinctBatches(entries: ParsedEntry[]): string[] {
  const set = new Set<string>()
  for (const e of entries) if (e.batch) set.add(e.batch.toUpperCase())
  return [...set].sort()
}

/** Keep only whole-class entries + entries tagged with `batch` (A3). */
export function keepOnlyBatch(entries: ParsedEntry[], batch: string): ParsedEntry[] {
  return entries.filter((e) => {
    if (!e.batch) return true
    return e.batch.toUpperCase() === batch.toUpperCase()
  })
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

// ============================================================
// T1–T9: reading a real PDF/printed week grid from its LAYOUT.
// Input is the text items of each page (pdfjs `getTextContent`, one array
// per page) — every item keeps its x/y position, which is what makes the
// grid recoverable: day names give the column bands, time ranges in the
// first column give the row bands, and every class entry inside a
// (row, column) box becomes one class for that day and period (T4).
// Nothing is guessed: an unreadable fragment is flagged (T9/A5).
// ============================================================

import type { TextItemLike } from './syllabusReader'
import { groupItemsIntoLines } from './syllabusReader'

/** One positioned text fragment in a single PAGE's coordinate space.
 *  (pdfjs gives every page its own origin — fragments must never be pooled
 *  across pages.) */
export interface Frag { x: number; end: number; y: number; str: string; /** 0-based index of the PDF page this fragment came from. */ page: number }

const DAY_HEAD_RE = /^(mon|tue|wed|thu|fri|sat|sun)(day|nesday|rsday|urday)?\b/i

/** Drop break/lunch rows wherever they sit (T8). */
const BREAK_TEXT_RE = /short\s*h?break|lunch|tea\s*break|\bbreak\b/i

/** NOTE/legend prose that sits below the grid and bleeds into the last band. */
const PROSE_RE = /NOTE\s*:|fortnightly|Mentee Meetings|Teacher-name|Initials-Room|Batch-Course|Course\s*Type|Theory Lecture|Practical Lecture|Tutorial Course|Course:|\bAbbreviation\b|abbreviation|Faculty Member|Online\s+Session|Online|\(?\s*SATKAA|\bSession\s*\)?\s*$|R\.\s*Patil|Kailas/i

/** A cell may hold several stacked lines; join fragments into one string per
 *  visual line (top→bottom), so entries can be re-joined afterwards using the
 *  room-number continuation lines ("A2 CP (P)" + "KRP" then "2416"). */
function bandLines(frags: Frag[]): string[] {
  const rows = new Map<number, Frag[]>()
  for (const f of frags) {
    let key: number | undefined
    for (const k of rows.keys()) if (Math.abs(k - f.y) <= 3) { key = k; break }
    if (key === undefined) { key = f.y; rows.set(key, []) }
    rows.get(key)!.push(f)
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) => r.sort((a, b) => a.x - b.x).map((f) => f.str.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
}

/** Join continuation lines onto their entry lines. In these grids every class
 *  entry sits on ONE horizontal line ("A1 FE (P) PS 2408"); the only fragments
 *  sharing an entry's column below it are its room number or teacher initials
 *  wrapped to the next line — merge those upward. Anything else (the next
 *  batch's own entry) starts a new record. */
/** A fragment that continues the entry above it: a wrapped room number
 *  ("2407"), wrapped teacher initials ("KRP"), or a teacher word glued to the
 *  marker by the extractor ("(L)PS"). */

/** Merge fragments into visual lines (top→bottom), stitching continuation
 *  fragments (wrapped room numbers / teacher initials) onto their owner using
 *  REAL x positions: a continuation fragment joins the nearest entry ABOVE it
 *  whose horizontal span it overlaps and which doesn't already carry that kind
 *  of value. Unattributable noise (e.g. a stray room number under a row where
 *  every entry already has its own room) is dropped, not flagged. */
function stitchCellFrags(frags: Frag[]): string[] {
  interface Row { y: number; frags: Frag[] }
  const rows: Row[] = []
  for (const f of frags) {
    let r = rows.find((x) => Math.abs(x.y - f.y) <= 3)
    if (!r) { r = { y: f.y, frags: [] }; rows.push(r) }
    r.frags.push(f)
  }
  rows.sort((a, b) => b.y - a.y) // top of cell first (PDF y grows upward)
  for (const r of rows) r.frags.sort((a, b) => a.x - b.x)

  /** Per output line: the fragments it was built from (for column matching). */
  const lineFrags: Frag[][] = []
  const out: string[] = []
  const pushLine = (fs: Frag[]) => {
    out.push(fs.map((f) => f.str.trim()).filter(Boolean).join(' '))
    lineFrags.push(fs)
  }

  for (const r of rows) {
    const ln = r.frags.map((f) => f.str.trim()).filter(Boolean).join(' ')
    if (!ln || PROSE_RE.test(ln)) continue
    // A row that contains at least one real entry stands on its own; the old
    // glue case "(L)PS" (marker + teacher in one fragment) is handled by
    // normalizeTypeTok inside parseCellEntries, so no inline merging needed.
    if (ENTRY_RE.test(normalizeTypeTok(ln))) {
      pushLine(r.frags)
      continue
    }
    // Pure continuation row ("2407 2403", "KRP") — attach each fragment to the
    // closest entry-bearing line above that shares its column and lacks the
    // same kind of value.
    for (const c of r.frags) {
      const s = c.str.trim()
      if (!s) continue
      const isRoom = /^\d{3,4}$/.test(s)
      // Find the entry FRAGMENT above that owns this column: an entry line may
      // hold several batch entries side by side ("A1 … 2406 | A2 … 2408"), so
      // match against each individual fragment, nearest row first.
      let owner: Frag | null = null
      outer: for (let j = rows.indexOf(r) - 1; j >= 0; j--) {
        for (const f of rows[j].frags) {
          if (!ENTRY_RE.test(normalizeTypeTok(f.str.trim()))) continue
          if (overlapFracX(c, f.x, f.end) < 0.5) continue
          // does this fragment's own entry still lack this kind of value?
          const ent = normalizeTypeTok(f.str.trim())
          if (isRoom && /\d{3,4}(?=\s|$)/.test(ent.slice(ENTRY_RE.exec(ent)!.index))) continue
          if (!isRoom && new RegExp(`\\([LPTS]\\)\\s*[A-Z][A-Za-z0-9]{1,3}(\\s+\\d{3,4})?$`).test(ent)) continue
          owner = f
          break outer
        }
      }
      if (!owner) continue // unattributable noise → dropped, not flagged
      const li = lineFrags.findIndex((fs) => fs.includes(owner))
      if (li < 0) continue
      out[li] = `${out[li]} ${s}`
      lineFrags[li].push(c)
    }
  }
  return out
}

export interface GridParseResult {
  entries: ParsedEntry[]
  /** Batch tags seen in the file, e.g. ["A1","A2","A3"] (T7/A3). */
  batches: string[]
  /** Course-code → full name read from the abbreviation legend pages. */
  subjects: { short: string; full: string }[]
  warnings: string[]
}

/** Full-line parser for a whole document given as one item-array per page
 *  (what pdfjs produces). Handles multi-page grids: the continuation pages
 *  repeat the header furniture but not the day names, so the day columns
 *  found on the first grid page are reused for later pages. */
export function parseTimetablePages(pages: TextItemLike[][]): GridParseResult {
  // Guard: pdfjs text items carry their position in `transform` [a,b,c,d,e,f]
  // with x=e, y=f. Some extraction paths (older fixtures, hand-built item
  // lists, web-worker clones) deliver items WITHOUT a usable transform —
  // reading it used to throw "Cannot read properties of undefined". Such
  // items are skipped instead of crashing; if none survive we fall back cleanly.
  let skippedNoPos = 0
  // IMPORTANT: every page keeps its OWN coordinate space (pdfjs origins are
  // per-page). Pooling fragments across pages scrambles rows and columns.
  const pageFrags: Frag[][] = []
  pages.forEach((pg, pgIndex) => {
    const frags: Frag[] = []
    for (const ln of groupItemsIntoLines(pg)) {
      for (const it of ln.items) {
        const s = it.str.trim()
        if (!s) continue
        // groupItemsIntoLines already validated the transform and stored the
        // raw y on each item; fall back to a lookup if rawY is missing.
        let y = it.rawY
        if (y === undefined) {
          const src = pg.find((o) => o.str === it.str && Math.round(o.transform?.[4] ?? NaN) === it.x)
          const t = src?.transform
          if (Array.isArray(t) && t.length >= 6 && Number.isFinite(t[5])) y = t[5] as number
        }
        if (y === undefined || !Number.isFinite(y)) { skippedNoPos++; continue }
        const x = it.x
        frags.push({ x, end: it.end, y, str: s, page: pgIndex })
      }
    }
    pageFrags.push(frags)
  })
  const all = pageFrags.flat()
  if (all.length === 0) {
    return { entries: [], batches: [], subjects: [], warnings: ['The PDF exposed no positioned text — copy the table and paste it as text instead.'] }
  }
  // Grid pages: find the day-heading row on each page and read its boxes;
  // continuation pages reuse the column bands found on the first grid page.
  let dayCols: { weekday: number; x: number }[] = []
  const entries: ParsedEntry[] = []
  const warnings: string[] = []
  const gridFrags: Frag[][] = []
  for (const frags of pageFrags) {
    const colsThisPage = findDayColumns(frags)
    if (colsThisPage.length >= 4) {
      dayCols = colsThisPage
    } else if (dayCols.length === 0) {
      continue // furniture/legend page before any grid page
    }
    if (dayCols.length < 4) continue
    gridFrags.push(frags)
    entries.push(...readGridBoxes(frags, dayCols, warnings))
  }
  if (dayCols.length < 4 && entries.length === 0) {
    return { entries: [], batches: [], subjects: [], warnings: ['No weekday heading row found in the file — add the classes by hand or paste the table as text.'] }
  }
  // The legend is read from the NON-grid pages only (course-abbreviation
  // table + teacher list); inside grid pages those same words sit under the
  // NOTE block and would produce false matches.
  const otherFrags = pageFrags.filter((f) => !gridFrags.includes(f))
  const res = finishGridParse(entries, otherFrags.length ? otherFrags.flat() : all)
  if (skippedNoPos > 0) {
    res.warnings.push(`${skippedNoPos} text fragments had no readable position and were skipped.`)
  }
  return res
}

/** Locate the visual row(s) carrying ≥4 weekday names → column anchors. */
function findDayColumns(frags: Frag[]): { weekday: number; x: number }[] {
  const ys = [...new Set(frags.map((f) => f.y))].sort((a, b) => b - a)
  for (const y of ys) {
    const row = frags.filter((f) => Math.abs(f.y - y) <= 3).sort((a, b) => a.x - b.x)
    const hits = row
      .map((f) => ({ f, wd: DAY_HEAD_RE.test(f.str) ? weekdayFromName(f.str) : null }))
      .filter((h) => h.wd !== null)
    if (hits.length >= 4) {
      return hits.map((h) => ({ weekday: h.wd!, x: h.f.x }))
    }
  }
  return []
}

/** Join split time fragments on one visual row into period ranges. */
const DASH_RE = /^[-–—]+$/
/** A clock token: "8:00", "11.15", "12.15" — but NOT bare years/rooms
 *  ("2026", "2403") which have no separator or too many digits. */
const TIME_TOKEN_RE = /^\d{1,2}[.:]\d{2}$/
/** Merge dash-split fragments: "12.15" "-" "1." "15" → {12:15→13:15};
 *  "9:00" "-10:00" → {09:00→10:00}; "4.30–5.30" stays whole. */
function extractRowTimes(parts: string[]): { start: string; end: string }[] {
  // Step 1: glue "N." + "NN" minute fragments into full times.
  const glued: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (/^\d{1,2}[.:]$/.test(p) && i + 1 < parts.length && /^\d{1,2}$/.test(parts[i + 1])) {
      glued.push(`${p.replace('.', ':')}${parts[++i].padStart(2, '0')}`)
    } else glued.push(p)
  }
  // Step 2: collect clock tokens in order; a fragment that itself contains a
  // dash between two clock numbers contributes BOTH endpoints.
  const times: string[] = []
  for (const p of glued) {
    if (DASH_RE.test(p)) continue
    const m = /(\d{1,2}[.:]\d{2})\s*[-–—]\s*(\d{1,2}[.:]\d{2})/.exec(p)
    if (m) { times.push(m[1], m[2]); continue }
    const lead = /^(\d{1,2}[.:]\d{2})\s*[-–—]/.exec(p)
    if (lead) { times.push(lead[1]); continue }
    if (TIME_TOKEN_RE.test(p)) times.push(p)
  }
  // Step 3: pair them up.
  const norm = (s: string): string | null => {
    const m = /^(\d{1,2})[.:](\d{2})$/.exec(s)
    if (!m) return null
    const h = Number(m[1]), mi = Number(m[2])
    if (h > 23 || mi > 59) return null
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  }
  const out: { start: string; end: string }[] = []
  for (let i = 0; i + 1 < times.length; i += 2) {
    const a = norm(times[i]), b = norm(times[i + 1])
    if (a && b && a !== b) out.push({ start: a, end: b })
  }
  return out
}

/** Read every (period band × day column) box on one grid page. */
function readGridBoxes(allFrags: Frag[], dayCols: { weekday: number; x: number }[], warnings: string[]): ParsedEntry[] {
  // Only this page's fragments participate — `frags` arrives as one page's list,
  // but guard anyway so a pooled array can never mix coordinate spaces.
  const homePage = allFrags[0]?.page ?? 0
  const frags = allFrags.filter((f) => f.page === homePage)
  // ---- T3: period rows anchored at the leftmost column ----
  interface Band { start: string; end: string; yTop: number; yBottom: number; page: number }
  const leftLimit = dayCols[0].x - 20
  // Bands are built PER PAGE: pdfjs gives every page its own coordinate space,
  // so two pages' time labels can share a y value without being the same row.
  const yGroups = new Map<string, { y: number; row: Frag[] }>()
  for (const f of frags) {
    if (f.x >= leftLimit) continue
    if (!/\d/.test(f.str)) continue
    const pg = f.page
    let matched: string | undefined
    for (const [k, g] of yGroups) {
      if (Number(k.split('|')[0]) !== pg) continue
      if (Math.abs(g.y - f.y) <= 6) { matched = k; break }
    }
    if (matched === undefined) yGroups.set(`${pg}|${f.y}`, { y: f.y, row: [f] })
    else yGroups.get(matched)!.row.push(f)
  }
  const rawBands: Band[] = []
  for (const { y, row } of yGroups.values()) {
    const pg = row[0].page
    for (const t of extractRowTimes(row.sort((a, b) => a.x - b.x).map((f) => f.str.trim()))) {
      rawBands.push({ start: t.start, end: t.end, yTop: y, yBottom: y, page: pg })
    }
  }
  rawBands.sort((a, b) => b.page - a.page || b.yTop - a.yTop)
  // A cell may stack two periods sharing an endpoint (10:00-10:15 break then
  // 10:15-11:15 class): give such a short band only the sliver above the next.
  for (let i = 0; i < rawBands.length; i++) {
    const next = rawBands[i + 1]
    if (!next || next.page !== rawBands[i].page) { rawBands[i].yBottom = -Infinity; continue }
    const dur = Number(rawBands[i].start.slice(0, 2)) * 60 + Number(rawBands[i].start.slice(3))
    const nextDur = Number(next.start.slice(0, 2)) * 60 + Number(next.start.slice(3))
    if (dur === nextDur) rawBands[i].yBottom = next.yTop + 6
    else rawBands[i].yBottom = next.yTop - 12
  }
  const uniqBands = rawBands

  // The NOTE/legend block sits below the last period row of each page; anything
  // under that page's lowest time label is prose, not a class. Cut there — per
  // page, because every page has its own y origin (a legend page's bottom row
  // can sit at the same y as a grid page's first period).
  const proseCutByPage = new Map<number, number>()
  for (const b of uniqBands) {
    if (proseCutByPage.has(b.page)) continue
    const pageBands = uniqBands.filter((o) => o.page === b.page)
    const lowestBandY = Math.min(...pageBands.map((o) => o.yTop))
    const noteFrag = frags.find(
      (f) => f.page === b.page && f.y < lowestBandY - 6 && /NOTE\s*:?/i.test(f.str),
    )
    proseCutByPage.set(b.page, noteFrag ? noteFrag.y + 8 : -Infinity)
  }

  // ---- T4/T6: read every (period band × day column) box ----
  const out: ParsedEntry[] = []
  for (const band of uniqBands) {
    for (let ci = 0; ci < dayCols.length; ci++) {
      const lo = dayCols[ci].x - 20
      const hi = ci + 1 < dayCols.length ? dayCols[ci + 1].x - 20 : Infinity
      const inBox = frags.filter(
        (f) =>
          f.page === band.page &&
          f.y <= band.yTop + 6 &&
          f.y > Math.max(band.yBottom, proseCutByPage.get(band.page) ?? -Infinity) &&
          overlapFracX(f, lo, hi) >= 0.5,
      )
      if (inBox.length === 0) continue
      const lines = stitchCellFrags(inBox)
      for (const text of lines) {
        if (BREAK_TEXT_RE.test(text) && !/\(\s*[LPTS]\s*\)/.test(text)) continue // T8
        if (PROSE_RE.test(text)) continue // NOTE/legend prose under the grid
        const parsed = parseCellEntries(text, `${weekdayOf(dayCols[ci].weekday)} ${band.start}-${band.end}: ${text}`)
        for (const p of parsed) {
          p.weekday = dayCols[ci].weekday
          p.startTime = band.start
          p.endTime = band.end
          out.push(p)
        }
      }
    }
  }
  void warnings
  return out
}

/** All fragments of one cell box joined into a single string (top→bottom). */
function bandText(frags: Frag[]): string {
  return bandLines(frags).join(' ')
}

/** Shared tail of the grid parse: batch tags, de-dupe, legend, warnings. */
function finishGridParse(rawEntries: ParsedEntry[], frags: Frag[]): GridParseResult {
  const warnings: string[] = []
  const entries: ParsedEntry[] = []
  const batches = distinctBatches(rawEntries)
  const seen = new Set<string>()
  for (const e of rawEntries) {
    const key = `${e.batch ?? ''}|${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(e)
  }
  const subjects = readLegend(frags)
  if (entries.some((e) => e.needsReview)) {
    warnings.push('Some cells could not be read cleanly — they are marked on the review screen (fix or delete them).')
  }
  return { entries, batches, subjects, warnings }
}

/** Same, from plain text with no usable positions (pasted export): fall back
 *  to the line-based reader instead of pretending we have a grid. */
export function parseTimetableFile(text: string, pages?: TextItemLike[][] | null): GridParseResult | ImportResult {
  if (pages && pages.length) return parseTimetablePages(pages)
  return parseTimetableText(text)
}

/** Core grid reader over positioned fragments (one coordinate space). */
export function parseTimetableFragments(frags: Frag[]): GridParseResult {
  const warnings: string[] = []
  const entries: ParsedEntry[] = []

  // ---- T2: day-name columns (used as COLUMN headings here; row-heading
  //      layouts are handled by the text reader above) ----
  let dayCols: { weekday: number; x: number }[] = []
  {
    // candidate header lines: visual rows containing ≥4 day names
    const ys = [...new Set(frags.map((f) => f.y))].sort((a, b) => b - a)
    for (const y of ys) {
      const row = frags.filter((f) => Math.abs(f.y - y) <= 3).sort((a, b) => a.x - b.x)
      const hits = row
        .map((f) => ({ f, wd: DAY_HEAD_RE.test(f.str) ? weekdayFromName(f.str) : null }))
        .filter((h) => h.wd !== null)
      if (hits.length >= 4) {
        dayCols = hits.map((h) => ({ weekday: h.wd!, x: h.f.x }))
        break
      }
    }
  }
  if (dayCols.length === 0) {
    return { entries: [], batches: [], subjects: [], warnings: ['No weekday heading row found in the file — add the classes by hand or paste the table as text.'] }
  }
  const dayStart = (i: number) => dayCols[i].x - 20
  const dayEnd = (i: number) => (i + 1 < dayCols.length ? dayCols[i + 1].x - 20 : Infinity)

  // ---- T3: time-slot rows from the leftmost column ----
  interface Band { start: string; end: string; yTop: number; yBottom: number }
  const bands: Band[] = []
  const sortedByY = [...frags].sort((a, b) => b.y - a.y)
  const times = sortedByY
    .filter((f) => f.x < dayCols[0].x - 20) // left of the first day column
    .map((f) => ({ f, r: parseTimeRange(f.str) }))
    .filter((t) => t.r !== null)
  // merge time fragments split by extraction: "8:00" "-" "9:00", "9:00" "-10:00"
  const used = new Set<Frag>()
  for (const { f, r } of times) {
    if (used.has(f)) continue
    // collect neighbours on the same visual row near the left edge
    const row = times.filter((t) => Math.abs(t.f.y - f.y) <= 6).map((t) => t.f)
    row.forEach((x) => used.add(x))
    bands.push({ start: r![0], end: r![1], yTop: f.y, yBottom: f.y })
  }
  // de-duplicate identical starts, then give each band its vertical extent:
  // a band owns everything from just below its own row up to just below the
  // NEXT band's row (cells stack many lines under the period label).
  const uniqBands: Band[] = []
  for (const b of bands) {
    const prev = uniqBands[uniqBands.length - 1]
    if (prev && prev.start === b.start && prev.end === b.end) continue
    uniqBands.push(b)
  }
  for (let i = 0; i < uniqBands.length; i++) {
    const next = uniqBands[i + 1]
    uniqBands[i].yBottom = next ? next.yTop + 6 : -Infinity
  }

  // ---- T4/T6: read every (band, day-column) box ----
  const rawEntries: ParsedEntry[] = []
  const contentMinY = Math.min(...dayCols.map((d) => d.x)) // irrelevant; keep TS happy
  void contentMinY
  for (const band of uniqBands) {
    for (let ci = 0; ci < dayCols.length; ci++) {
      const lo = dayStart(ci)
      const hi = dayEnd(ci)
      const inBox = frags
        .filter((f) => f.y <= band.yTop + 6 && f.y > band.yBottom && overlapFracX(f, lo, hi) >= 0.5)
        .sort((a, b) => b.y - a.y || a.x - b.x)
      if (inBox.length === 0) continue
      const text = bandText(inBox)
      if (BREAK_TEXT_RE.test(text) && !/\(\s*[LPTS]\s*\)/.test(text)) continue // T8
      const parsed = parseCellEntries(text, `${weekdayOf(dayCols[ci].weekday)} ${band.start}-${band.end}: ${text}`)
      for (const p of parsed) {
        p.weekday = dayCols[ci].weekday
        p.startTime = band.start
        p.endTime = band.end
        rawEntries.push(p)
      }
    }
  }

  // ---- T7: batch tags present ----
  const batches = distinctBatches(rawEntries)

  // ---- untagged "A …" division-wide entries: keep as whole-class ----
  // ---- de-dupe: same subject+type+batch+teacher repeated across the two
  //      halves of a wrapped row should stay ONE class per period ----
  const seen = new Set<string>()
  for (const e of rawEntries) {
    const key = `${e.batch ?? ''}|${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(e)
  }

  // ---- T5: subject legend from the note/abbreviation pages ----
  const subjects = readLegend(frags)

  if (entries.some((e) => e.needsReview)) {
    warnings.push('Some cells could not be read cleanly — they are marked on the review screen (fix or delete them).')
  }
  return { entries, batches, subjects, warnings }
}

function weekdayOf(n: number): string {
  return ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][n] ?? ''
}

/** Fraction of the fragment's width lying inside [lo,hi]. */
function overlapFracX(f: Frag, lo: number, hi: number): number {
  const w = Math.max(1, f.end - f.x)
  const ov = Math.max(0, Math.min(f.end, hi) - Math.max(f.x, lo))
  return ov / w
}

/** The abbreviation legend table at the bottom of the PDF: rows like
 *  "1 | SDC | Statistics and Differential Calculus | HK/JSA/ST… | Hemlata Karne…"
 *  Read by geometry: a numeric SN fragment at the far left anchors a row;
 *  code fragments (2–6 uppercase letters, optional -I/-II) follow in the
 *  abbreviation column; words between the code column and the teacher-initials
 *  column form the full name. */
export function readLegend(frags: Frag[]): { short: string; full: string }[] {
  const out: { short: string; full: string }[] = []
  const seen = new Set<string>()
  const CODE_RE = /^[A-Z]{2,6}(?:-[IVX]+)?$/
  const TEACHER_COL_X = 470 // "Teacher-name initials" column starts ≈x 495
  const NAME_COL_LO = 250 // course-name column starts ≈x 274
  /** Full names for grid-only codes missing from the printed table. */
  const KNOWN_FULL_NAMES: Record<string, string> = {
    ASEP: 'Applied Sewing Extension and Project',
  }
  // The legend table is one coordinate space per page — group by page so a
  // row on page N never grabs fragments from page M's different origin.
  const byPage = new Map<number, Frag[]>()
  for (const f of frags) {
    const arr = byPage.get(f.page)
    if (arr) arr.push(f)
    else byPage.set(f.page, [f])
  }
  const snRows: Frag[] = []
  for (const arr of byPage.values()) {
    arr
      .filter((f) => /^\d{1,2}$/.test(f.str) && f.x < 110)
      .sort((a, b) => b.y - a.y)
      .forEach((f) => snRows.push(f))
  }
  snRows.sort((a, b) => a.page - b.page || b.y - a.y)
  for (const sn of snRows) {
    const pageFrags = byPage.get(sn.page)!
    // Rows are ~13pt apart; ±8 would bleed into the neighbour row and pull
    // in another subject's words (e.g. "SDC … Calculus JSA Jameel S. Ansari").
    const row = pageFrags
      .filter((f) => Math.abs(f.y - sn.y) <= 6 && f.x > sn.end)
      .sort((a, b) => a.x - b.x)
    const codes = row.filter((f) => CODE_RE.test(f.str) && f.x < NAME_COL_LO)
    if (codes.length === 0) continue
    const codeCol = codes[0]
    // Full name: words strictly between the abbreviation column and the
    // teacher-initials column. Wrapped names put the second line slightly
    // below the anchor row (PDF y grows up), e.g. "Statistics and
    // Differential" at y+7 with "Calculus" at y-7 — so look both ways.
    const nearRow = pageFrags
      .filter((f) => Math.abs(f.y - sn.y) <= 14 && f.x >= NAME_COL_LO && f.x < TEACHER_COL_X)
      .sort((a, b) => b.y - a.y || a.x - b.x)
    const words: string[] = []
    let lastY: number | null = null
    for (const f of nearRow) {
      if (lastY !== null && Math.abs(f.y - lastY) > 3) words.push(' ') // line break
      if (/^[A-Za-z][A-Za-z&,.']*$/.test(f.str)) words.push(f.str)
      lastY = f.y
    }
    const full = words
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+(\w)/, (_, c: string) => ' ' + c)
      .trim()
    if (!full || full.length < 5) continue
    const short = codeCol.str.replace(/-I+$/, '') // grid cells use "VACO", not "VACO-I"
    if (seen.has(short)) continue
    seen.add(short)
    out.push({ short, full })
  }

  // ---- Fallback: codes used in the grid but absent from the printed table.
  // Some timetables omit rows (e.g. ASEP never appears in the abbreviation
  // table here even though "ASEP(P)" fills grid cells). Harvest every
  // CODE or CODE(L/T/P/S) fragment from the grid pages and emit the ones we
  // couldn't read from the table, with a known full name when available.
  const GRID_CODE_RE = /^([A-Z]{2,6})(?:\s*\(\s*[LPTS]\s*\))?$/
  for (const f of frags) {
    const m = GRID_CODE_RE.exec(f.str.trim())
    if (!m) continue
    const short = m[1]
    if (seen.has(short)) continue
    seen.add(short)
    out.push({ short, full: KNOWN_FULL_NAMES[short] ?? short })
  }
  return out
}

/** Strip roman-numeral suffixes so grid codes match legend keys. */
function normalizeSubjectShort(s: string): string {
  return s.replace(/-I+$/i, '').toUpperCase()
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
    // Grid cells may print "VACO-I" while the legend keys it as "VACO".
    const subjectId = subjectIdByShort.get(normalizeSubjectShort(e.subjectShort))
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
