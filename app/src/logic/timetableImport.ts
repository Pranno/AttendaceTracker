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
  /** Internal: entry was merged into a twin during repair/dedupe. */
  dropped?: boolean
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

/** College grids print afternoon periods in 12-hour form without am/pm
 *  ("1.15 - 2.15", "4.30– 5.30"). No class runs between 1 and 7 in the
 *  morning, so hours 1–6 are afternoon. Without this the slots were stored
 *  as 01:15/02:15, sorted before the 8:00 class and reminders fired at night. */
export function collegeHour(h: number): number {
  return h >= 1 && h <= 6 ? h + 12 : h
}

/** "8:00 - 9:00", "11.15 – 12.15", "1.15 - 2.15" → ["08:00","09:00"], …, ["13:15","14:15"]. */
export function parseTimeRange(text: string): [string, string] | null {
  const m = /(\d{1,2})[.:](\d{2})?\s*[-–—]\s*(\d{1,2})[.:](\d{2})?/.exec(text)
  if (!m) return null
  const h1 = Number(m[1]), m1 = m[2] ? Number(m[2]) : 0
  const h2 = Number(m[3]), m2 = m[4] ? Number(m[4]) : 0
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null
  const fmt = (h: number, mi: number) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  // "2:15 - 3:15" after lunch is afternoon; ranges never cross midnight here.
  return [fmt(collegeHour(h1), m1), fmt(collegeHour(h2), m2)]
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
// Division letters cover A–Z in real college grids (Div F prints "F1 CP (P) SK"
// and bare-"F" whole-class rows); restricting to [A-E] silently rejected every
// Div F entry and the division parsed to zero classes.
// A batch tag is a division letter + an OPTIONAL digit. The digit must be
// glued to the letter: requiring `[A-Z]\s*[.\s-]+\d` would let the NEXT
// token's leading digits masquerade as a batch number ("F" "FE" "3 WAD…"
// read as one line became batch "FE3", subject "WAD"), silently dropping
// whole cells of the Div F grid.
const BATCH_G = String.raw`[A-Z](?:[1-9])?`
// Subject codes may contain hyphens ("VACO-I") or a space inserted by PDF
// word-wrap/kerning ("SD C", "ASE P"). The old pattern stopped at the first
// space, so those cells split into two half-entries and landed in NEEDS
// REVIEW. The continuation must be followed by whitespace/the type marker —
// otherwise it would swallow the teacher initials ("CP (L) KRP" → subj
// "K R"). Hyphen parts stay intact because "-" is not in [A-Z0-9].
const SUBJ_G = String.raw`[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*(?:\s+[A-Z][A-Z0-9]*(?=\s|$))?`
// Batch tag inside an entry line: the separator after it must NOT be "-",
// or "A3 WAD (P)" would let "-WAD" bleed into the batch group.
const BATCH_SEP = String.raw`[.\s]+`
const ENTRY_RE = new RegExp(
  String.raw`^(?:(?<batch>${BATCH_G})${BATCH_SEP})?(?<subj>${SUBJ_G})\s*` +
    `(?<typeTok>${TYPE_TOK})\\s*(?:(?<teacher>[A-Z][A-Za-z0-9]{1,3})(?:\\s+(?<room>\\d{3,4}))?)?`,
)
/** Clean up a subject code: unify separators, keep internal hyphens/spaces
 *  that belong to the code. PDF grids print multi-part codes with stray
 *  spaces from kerning/word-wrap ("SD C" → SDC, "ASE P" → ASEP, "VACO I" →
 *  VACO-I); single-letter segments join with a hyphen, longer ones glue on. */
function normalizeSubject(s: string): string {
  const u = s.toUpperCase().replace(/\s+/g, ' ').trim()
  return u.replace(/(?:^|\s)([A-Z])(?=\s|$)/g, '-$1').replace(/[\s]/g, '')
}
/** The course-type letter out of whichever spelling of "(P)" was matched. */
function typeLetterOf(typeTok: string | undefined): string | undefined {
  if (!typeTok) return undefined
  const m = /\(\s*([LPTS])/i.exec(typeTok)
  return m ? m[1].toUpperCase() : undefined
}

/** Normalise the PDF's broken-up spellings of the course-type marker:
 *  "( L )" → "(L)", and a type glued to the following word ("(L)PS") gets a
 *  space so the teacher/room tokens stay readable. Also splits glued words
 *  ("ShortBreak" → "Short Break", "FE(L)" → "FE (L)") produced by some
 *  exports, and inserts a space between two adjacent entry markers
 *  ("(P)(L)" → "(P) (L)") so multi-batch cells split cleanly. */
function normalizeTypeTok(text: string): string {
  return splitGluedWords(text)
    .replace(/\(\s+([LPTS])\s+\)/g, '($1)')
    .replace(/\(\s*([LPTS])\s*\)/g, '($1)')
    .replace(/(?<=[A-Za-z0-9)\]])\((?=[LPTS]\))/g, ' (') // FE(L) → FE (L)
    .replace(/\)\((?=[LPTS]\))/g, ') (') // (P)(L) → (P) (L)
    .replace(/\(([LPTS])(?=[A-Za-z(])/g, '($1) ')
}

/** Parse every class entry inside one timetable cell (cells can stack several batches). */
export function parseCellEntries(cell: string, rawLine: string): ParsedEntry[] {
  const out: ParsedEntry[] = []
  const norm = normalizeTypeTok(cell.replace(/\s+/g, ' ').trim())
  // Split on boundaries where a new BATCH(+num)/division + SUBJECT pair starts.
  const parts = norm
    // A new entry only starts at the beginning of a word: without the
    // lookbehind "A VACO-I (L)" split inside the code ("VAC" + batch "O",
    // subject "I") and the class landed in NEEDS REVIEW.
    .split(new RegExp(`(?<=^|\\s)(?=(?:${BATCH_G}[1-9]?[.\\s-]+)${SUBJ_G}\\s*${TYPE_TOK})`))
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
      subjectShort: normalizeSubject(m.groups.subj!),
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
    if (/^[A-Z][1-9]$/.test(c) && !subj) { batch = c; continue }
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

  // --- Day columns: find a header row listing weekdays. Accept two shapes:
  // a tabular row with several days in one line, or a vertical column-header
  // list (PDF text pastes often put "Monday", "Tuesday", … on their own
  // lines before the cells). ---
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
  if (!dayColumns) {
    let run = 0
    for (const line of lines) {
      if (line.split(/\s+/).length === 1 && weekdayFromName(line) !== null) {
        run++
        if (run >= 3) { dayColumns = []; break }
      } else if (line.split(/\s+/).length > 1) {
        run = 0
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
    warnings.push('Couldn’t find weekday columns or time rows in the text. Best options: (1) upload the timetable PDF file directly, or (2) use CSV rows like “Monday,08:00,09:00,A1,FE,P,PS,2408”.')
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
    const key = `${e.batch ?? '∅'}|${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
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
 *  across pages.) `y` is the TRUE baseline: line grouping rounds the row key
 *  but must not round the fragment, or wrapped continuation rows land on the
 *  same y as entry rows and get glued to them (the old "Tuesday classes read
 *  onto Monday" shift). */
export interface Frag { x: number; end: number; y: number; str: string; /** 0-based index of the PDF page this fragment came from. */ page: number }

const DAY_HEAD_RE = /^(mon|tues|tue|wed|thu|fri|sat|sun)(day|nesday|rsday|urday)?\b/i

/** Drop break/lunch rows wherever they sit (T8). Also catches the glued
 *  spellings pdf.js emits on some exports ("ShortBreak", "LUNCHBREAK"). */
const BREAK_TEXT_RE = /short\s*h?\s*break|lunch\s*break|lunch|tea\s*break|\bbreak\b/i

/** Is this period band a break (short break / lunch) rather than a class
 *  period? Two signals:
 *  1. it is too short to be a class (10:00–10:15, 4:15–4:30 — every class
 *     period is ≥ 1 h), or
 *  2. its own time-label row carries a break word ("Short Break",
 *     "LUNCH BREAK") and NO class entry.
 * Signal 2 must ignore rows that also hold classes: colleges stagger lunch
 * per day, so "LUNCH BREAK" printed in Wednesday's 11:15 cell sits on the
 * same row as Monday's and Tuesday's 11:15 classes. The old rule (any break
 * word on the row, or a hard-coded 10:00/12:15 start) dropped those whole
 * rows; individual break CELLS are skipped by the cell reader instead. */
function isBreakBand(band: { start: string; end: string; yTop: number; page: number }, frags: Frag[]): boolean {
  const dur = toMinutes(band.end) - toMinutes(band.start)
  if (dur > 0 && dur <= 20) return true
  const row = frags.filter((f) => f.page === band.page && Math.abs(f.y - band.yTop) <= 6)
  const joined = normalizeTypeTok(row.map((f) => f.str).join(' '))
  return BREAK_TEXT_RE.test(joined) && !/\(\s*[LPTS]\s*\)/.test(joined)
}

const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** NOTE/legend prose that sits below the grid and bleeds into the last band. */
const PROSE_RE = /NOTE\s*:|fortnightly|Mentee Meetings|Teacher-name|Initials-Room|Batch-Course|Course\s*Type|Theory Lecture|Practical Lecture|Tutorial Course|Course:|\bAbbreviation\b|abbreviation|Faculty Member|Online\s+Session|Online|\(?\s*SATKAA|\bSession\s*\)?\s*$|R\.\s*Patil|Kailas/i

/** Glued words produced by some PDF exports ("ShortBreak", "LUNCHBREAK",
 *  "(SATKAAM"). Split them back so break/prose filters recognise the text.
 *  Also splits a subject code glued to its type marker ("ASEP(P)" →
 *  "ASEP (P)") and a teacher/room glued after a room number ("JSA2407" →
 *  "JSA 2407") — both spellings appear in real division exports. */
function splitGluedWords(s: string): string {
  return s
    .replace(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .replace(/([A-Z]{3,})/g, (w) => {
      if (/^(SHORTBREAK|LUNCHBREAK)$/.test(w)) return `${w.slice(0, w.length - 5)} ${w.slice(-5)}`
      if (/^SATKAAM/.test(w)) return 'SATKAAM'
      return w
    })
    // FE(L) / ASEP(P) → add space BEFORE the marker (ENTRY_RE wants "CODE (X)").
    // The lookbehind excludes ")" so the (P)(L) boundary rule below is untouched.
    // (The old lookahead put the space one character too early: "ASEP(P)" →
    // "ASE P(P)", read as subject "ASE-P"; "SDC(L)" → "SD-C".)
    .replace(/(?<=[A-Za-z0-9])(?=\([LPTS]\))/g, ' ')
    // "JSA2407" → "JSA 2407": initials glued to the wrapped room number.
    .replace(/([A-Za-z])(\d{3,4})(?=\s|$)/g, '$1 $2')
}

/** Does this PAGE carry the abbreviation table? The table header (the "S.N."
 *  cell plus its "abbreviation" / "Course Name" neighbour cells) is the only
 *  reliable marker — and it sits in the LOWER part of the page, below the
 *  grid. Keying on loose number+word rows instead would flag ordinary
 *  furniture ("1 IQAC-103", SN columns inside the grid) and silently drop a
 *  whole grid page's classes. */
function pageHasLegendTable(frags: Frag[]): boolean {
  const sn = frags.find((f) => /^S\.?\s*N\.?$/i.test(f.str.trim()))
  if (!sn) return false
  const sameRow = frags.filter((f) => Math.abs(f.y - sn.y) <= 8)
  const headerish = sameRow.filter((f) => f.x > sn.x)
  const hasAbbrWord = headerish.some((f) => /abbrev/i.test(f.str))
  const hasNameWord = headerish.some((f) => /course|name|teacher/i.test(f.str))
  // A real legend-table header never sits above the weekday heading row; if
  // this page also carries a day-header row at least as high up, the "S.N."
  // hit is grid furniture, not the abbreviation table.
  const dayY = Math.max(...frags.filter((f) => DAY_HEAD_RE.test(f.str)).map((f) => f.y), -Infinity)
  if (Number.isFinite(dayY) && sn.y >= dayY) return false
  return hasAbbrWord && hasNameWord
}

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

/** A cell line may stack several batch entries side by side ("A1 … 2406 |
 *  A2 … 2408"). Split it at the point where a new entry begins: an optional
 *  batch tag followed by CODE + type marker. Boundaries are found with a
 *  lookBEHIND over already-consumed text so positions stay exact even when
 *  fragments glue tokens together ("(L)PS" or "ASEP(P)"). */
function splitEntryLine(line: string): string[] {
  const norm = normalizeTypeTok(line.replace(/\s+/g, ' ').trim())
  if (!ENTRY_RE.test(norm)) return [norm]
  const boundary = new RegExp(
    String.raw`(?<=^|[^\w)])((?:${BATCH_G}(?:[1-9])?${BATCH_SEP})?${SUBJ_G}\s*${TYPE_TOK})`,
    'g',
  )
  const starts: number[] = []
  let m: RegExpExecArray | null
  while ((m = boundary.exec(norm))) {
    // only real entry starts (the regex above could also fire mid-word)
    if (m.index > 0 && /[A-Za-z]/.test(norm[m.index - 1])) continue
    starts.push(m.index)
  }
  if (starts.length <= 1) return [norm]
  const parts: string[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : norm.length
    const piece = norm.slice(starts[i], end).trim()
    if (piece) parts.push(piece)
  }
  return parts.length ? parts : [norm]
}

/** Merge fragments into visual lines (top→bottom), stitching continuation
 *  fragments (wrapped room numbers / teacher initials) onto their owner using
 *  REAL x positions: a continuation fragment joins the nearest entry ABOVE it
 *  whose horizontal span it overlaps and which doesn't already carry that kind
 *  of value. Unattributable noise (e.g. a stray room number under a row where
 *  every entry already has its own room) is dropped, not flagged. */
export function stitchCellFrags(frags: Frag[]): string[] {
  interface Row { y: number; frags: Frag[] }
  const rows: Row[] = []
  for (const f of frags) {
    let r = rows.find((x) => Math.abs(x.y - f.y) <= 3)
    if (!r) { r = { y: f.y, frags: [] }; rows.push(r) }
    r.frags.push(f)
  }
  rows.sort((a, b) => b.y - a.y) // top of cell first (PDF y grows upward)
  for (const r of rows) r.frags.sort((a, b) => a.x - b.x)

  /** Per output line: one owning entry fragment (for column matching) plus a
   *  fragment that stands for the whole line (fallback). */
  const lineOwners: Frag[] = []
  const lineReps: Frag[] = []
  const out: string[] = []
  const pushLine = (fs: Frag[]) => {
    const ln = fs.map((f) => f.str.trim()).filter(Boolean).join(' ')
    // One output LINE per source fragment when any fragment holds a real
    // entry start. Stacked cells put each batch entry on its own baseline
    // ("A1 CP (P) DTM" at y=221, "A2 FE (P) PS 2408" at y=193); joining the
    // whole visual band into one string loses which entry a wrapped room /
    // teacher continuation below belongs to. Per-fragment lines keep the
    // ownership exact — a continuation attaches to the entry line directly
    // above it in the same column.
    // A fragment is an "entry start" only when it BEGINS with the entry
    // pattern. Bare batch tags ("A1", "A2") and bare subjects ("FE") match
    // ENTRY_RE internally because every group except the subject is optional,
    // but they don't start a class record — requiring m.index === 0 keeps them
    // from being treated as standalone lines (which made pushLine emit one
    // output line per tag fragment and lose the joined-line context entirely).
    const isStart = (s: string): boolean => {
      const n = normalizeTypeTok(s)
      const m = ENTRY_RE.exec(n)
      return !!m && m.index === 0 && m[0].length >= n.trim().length - 14
    }
    const entryFrags = fs.filter((f) => isStart(f.str.trim()))
    if (entryFrags.length > 1) {
      for (const f of entryFrags) {
        for (const p of splitEntryLine(f.str.trim())) {
          out.push(p)
          lineOwners.push(f)
          lineReps.push(f)
        }
      }
      return
    }
    for (const p of splitEntryLine(ln)) {
      // The fragment holding this piece's subject code owns continuations.
      // Hyphenated codes ("VACO-I") get wrapped across visual lines, so a
      // bare continuation like "JK 2403" must be matched against the FULL
      // joined line text, not just the first token — otherwise ownership
      // falls back to fs[0] and later parsing flags the entry as needing
      // review. Prefer exact-subject match, then joined-line containment.
      const subj = p.match(/^[A-Z](?:[1-9])?[.\s-]+([A-Z][A-Z0-9]*(?:-[IVX]+)?)|^[A-Z][A-Z0-9]*(?:-[IVX]+)?/)?.[1] ?? ''
      const normF = (s: string) => normalizeTypeTok(s).toUpperCase()
      let owner = fs.find((f) => normF(f.str).includes(subj)) ?? null
      if (!owner && subj) {
        // check which fragment contains a prefix of the subject within the
        // whole line (handles "VACO-" on one frag + "I" glued to next frag)
        owner = fs.find((f) => {
          const fu = normF(f.str)
          const lu = ln.toUpperCase()
          const idx = lu.indexOf(subj)
          if (idx < 0) return false
          const fragIdx = fu.indexOf(subj.slice(0, Math.max(2, subj.length - 2)))
          return fragIdx >= 0
        }) ?? null
      }
      out.push(p)
      lineOwners.push(owner ?? fs[0])
      lineReps.push(fs[0])
    }
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
    // When the extractor glues several tokens onto ONE baseline ("A CP (L) PS
    // 2406" or "(P) CK 2416"), the glued room/teacher live INSIDE that
    // fragment — pre-split them into standalone fragments (same y, estimated
    // x from character offsets) so the ownership pass below can see and
    // attribute them.
    const expanded: Frag[] = []
    for (const f of r.frags) {
      const s = f.str.trim()
      let m = /([A-Za-z)])\s+(\d{3,4})\s*$/.exec(s)
      if (m && !/^\d/.test(s)) {
        const roomStart = f.x + (m.index + m[1].length + 1) * ((f.end - f.x) / Math.max(1, f.str.length))
        expanded.push({ ...f, str: s.slice(0, m.index + m[1].length).trim(), end: roomStart })
        expanded.push({ x: roomStart, end: f.end, y: f.y, str: m[2], page: f.page })
        continue
      }
      m = /\((?:[LPTS])\)\s+([A-Z][A-Za-z0-9]{1,3})\s*$/i.exec(s)
      if (m && !ENTRY_RE.test(normalizeTypeTok(s))) {
        // marker+teacher glue with no subject code → standalone teacher frag
        const tStart = f.x + (m.index + m[0].length - m[1].length) * ((f.end - f.x) / Math.max(1, f.str.length))
        expanded.push({ ...f, str: s.slice(0, m.index).trim(), end: tStart })
        expanded.push({ x: tStart, end: f.end, y: f.y, str: m[1], page: f.page })
        continue
      }
      expanded.push(f)
    }
    r.frags = expanded.sort((a, b) => a.x - b.x)
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
          if (overlapFracX(c, f.x - 2, f.end + 2) < 0.5) continue
          // does this fragment's own entry still lack this kind of value?
          const ent = normalizeTypeTok(f.str.trim())
          if (isRoom && /\d{3,4}(?=\s|$)/.test(ent.slice(ENTRY_RE.exec(ent)!.index))) continue
          if (!isRoom && new RegExp(`\\([LPTS]\\)\\s*[A-Z][A-Za-z0-9]{1,3}(\\s+\\d{3,4})?$`).test(ent)) continue
          owner = f
          break outer
        }
      }
      if (!owner) continue // unattributable noise → dropped, not flagged
      // prefer the exact per-entry line owned by this fragment — and for room
      // numbers, only a line that doesn't ALREADY carry one (otherwise the
      // continuation lands on the wrong entry in a multi-batch cell). Fall
      // back to any line built from the same source fragment (nearest wins).
      const isRoomC = /^\d{3,4}$/.test(s)
      let li = lineOwners.findIndex(
        (o, idx) => o === owner && !(isRoomC && /\s\d{3,4}(?=\s|$)/.test(out[idx])),
      )
      if (li < 0) li = lineOwners.indexOf(owner)
      if (li < 0) continue
      out[li] = `${out[li]} ${s}`
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
/** Some PDF producers make pdf.js emit ONE item per word ("A1", "FE", "(P)",
 *  "PS", "2408") instead of one item per text run. Every heuristic below is
 *  tuned for run-level items (a whole "A1 FE (P) PS 2408" entry per item), and
 *  on word-level pages batch tags get separated from their entry, hyphenated
 *  codes split and continuation pages are lost. Re-join such pages into runs:
 *  consecutive words on the same baseline with a word-space-sized gap
 *  (inter-cell gaps are several times larger) become one item. Pages that
 *  already contain multi-word items are left untouched. */
function mergeWordItems(items: TextItemLike[]): TextItemLike[] {
  const positioned = items.filter(
    (it) => typeof it.str === 'string' && Array.isArray(it.transform) && it.transform.length >= 6 &&
      Number.isFinite(it.transform[4]) && Number.isFinite(it.transform[5]),
  )
  const nonEmpty = positioned.filter((it) => it.str.trim())
  if (nonEmpty.length < 20 || nonEmpty.some((it) => /\S\s+\S/.test(it.str.trim()))) return items
  const widthOf = (it: TextItemLike) => it.width ?? it.str.length * 6
  const sorted = [...nonEmpty].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
  const out: TextItemLike[] = []
  let cur: TextItemLike | null = null
  for (const it of sorted) {
    if (cur !== null) {
      const prev: TextItemLike = cur
      const curEnd = prev.transform[4] + widthOf(prev)
      const gap = it.transform[4] - curEnd
      const fontSize = Math.abs(it.transform[3] || it.transform[0] || 10)
      if (Math.abs(prev.transform[5] - it.transform[5]) <= 0.5 && gap >= -1 && gap <= Math.max(4.5, fontSize * 0.45)) {
        const end = it.transform[4] + widthOf(it)
        cur = { ...prev, str: `${prev.str.trimEnd()} ${it.str.trimStart()}`, width: end - prev.transform[4] }
        continue
      }
      out.push(prev)
    }
    cur = { ...it, transform: [...it.transform] }
  }
  if (cur) out.push(cur)
  // keep items without a usable position so the caller can still count them
  return [...out, ...items.filter((it) => !positioned.includes(it))]
}

export function parseTimetablePages(pages: TextItemLike[][]): GridParseResult {
  pages = pages.map(mergeWordItems)
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
    // Group into visual lines with the TRUE baselines kept on each fragment.
    // (Rounding the y here used to collapse wrapped continuation rows onto
    // entry rows and shift whole cells one day/period over.)
    for (const ln of groupItemsIntoLines(pg, pgIndex)) {
      for (const it of ln.items) {
        const s = it.str.trim()
        if (!s) continue
        // Prefer the item's own rawY; fall back to a lookup in the source
        // items for hand-built fixtures that lack transform metadata.
        let y = it.rawY ?? it.y
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
    // ---- Split glued extraction runs (T2/T3 hardening) ----
    // pdf.js sometimes merges an entire visual row into ONE item
    // ("8:00 - 9:00 A2 WAD (P) YP 2314 A FE (L) PS 2406"). Such mega-fragments
    // have no usable x-extent, so they overlap EVERY day column at once and
    // the whole row gets read under Monday (the "Tuesday classes appear on
    // Monday" symptom). Cut them at period boundaries (a time range followed
    // by a class entry) and emit sub-fragments evenly spaced across the run's
    // width — enough positional signal for correct column attribution.
    const ENTRY_TOK_RE = /[A-Z][A-Z0-9]*(?:-[IVX]+)?\s*\(\s*[LPTS]\s*\)/i
    const TIME_HEAD_RE = /\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?/
    const splitFrags: Frag[] = []
    for (const f of frags) {
      const wideEnough = f.end - f.x > 60 // a real run of text
      const glued = wideEnough && TIME_HEAD_RE.test(f.str) && (f.str.match(ENTRY_TOK_RE) ?? []).length >= 2
      if (!glued) { splitFrags.push(f); continue }
      // cut points: just before each time range that follows an entry token
      const cuts: number[] = [0]
      const re = new RegExp(String.raw`${ENTRY_TOK_RE.source}[^]*?(?=${TIME_HEAD_RE.source})`, 'gi')
      let mm: RegExpExecArray | null
      while ((mm = re.exec(f.str))) cuts.push(mm.index + mm[0].length)
      cuts.push(f.str.length)
      const uniqCuts = [...new Set(cuts)].sort((a, b) => a - b)
      const pieces: string[] = []
      for (let i = 0; i + 1 < uniqCuts.length; i++) {
        const piece = f.str.slice(uniqCuts[i], uniqCuts[i + 1]).trim()
        if (piece) pieces.push(piece)
      }
      if (pieces.length <= 1) { splitFrags.push(f); continue }
      const w = f.end - f.x
      pieces.forEach((p, i) => {
        splitFrags.push({
          x: f.x + (w * i) / pieces.length,
          end: f.x + (w * (i + 1)) / pieces.length,
          y: f.y,
          str: p,
          page: f.page,
        })
      })
    }
    pageFrags.push(splitFrags)
  })
  const all = pageFrags.flat()
  if (all.length === 0) {
    return { entries: [], batches: [], subjects: [], warnings: ['The PDF exposed no positioned text — copy the table and paste it as text instead.'] }
  }
  // Grid pages: find the day-heading row on each page and read its boxes.
  // Continuation pages usually repeat the header FURNITURE but not the day
  // names, so we build the day-column set from the UNION of every page that
  // has a header row, interpolating any day whose heading was missed (e.g. a
  // "Tuesday" split by the extractor) — otherwise Tuesday's classes get
  // attributed to Monday because Monday's band stretches over it. Pages with
  // no header are validated against these bands before being read.
  // Day columns are computed PER PAGE. Every page has its own coordinate
  // space and its own column geometry — page 2's grid starts further right
  // than page 1's Monday column, so forcing page-2 cells through page-1 bands
  // silently drops the afternoon classes. Pages without their own heading row
  // get Mon–Sat anchors interpolated from the observed heading pitch.
  const colsByPage = dayColsByPage(pageFrags)
  const headerPages = colsByPage.filter(Boolean) as { weekday: number; x: number }[][]
  const dayCols = headerPages[0] ?? []
  // Legend-only pages must NEVER reach the grid reader: the abbreviation
  // table ("1 CP Computer Programming KRP Kailas R. Patil") contains code+
  // initials pairs that parse as real entries, and their x positions land in
  // the Monday/Tuesday bands — producing phantom classes on the wrong days.
  // A page is exempt only if it has NO day-heading row of its own; pages that
  // DO carry the weekday header are always grid pages even when a stray
  // numeric-SN + word pattern appears on them.
  // A page may carry BOTH the tail of the grid (afternoon periods) and, lower
  // down, the NOTE block + abbreviation table. Excluding such a page outright
  // silently dropped every class on it (Div A lost 12:15 onwards), so only the
  // part ABOVE the NOTE / table header is offered to the grid reader.
  const gridPageFrags = pageFrags.map((frags, pi) => {
    if (findDayColumns(frags).length >= 4 || !pageHasLegendTable(frags)) return { frags, cols: colsByPage[pi] }
    const cutY = Math.max(
      ...frags.filter((f) => /^S\.?\s*N\.?$/i.test(f.str.trim()) || /^NOTE\s*:?$/i.test(f.str.trim())).map((f) => f.y),
    )
    return { frags: frags.filter((f) => f.y > cutY + 8), cols: colsByPage[pi] }
  }).filter(({ frags }) => frags.length > 0)
  const entries: ParsedEntry[] = []
  const warnings: string[] = []
  const gridFrags: Frag[][] = []
  let carry: { start: string; end: string } | null = null
  for (const { frags, cols } of gridPageFrags) {
    if (!cols || cols.length < 4) continue
    const hasHeader = findDayColumns(frags).length >= 4
    if (!hasHeader) {
      // Continuation page: only treat it as part of the grid when its class
      // fragments actually spread across ≥2 day columns. A legend/notes page
      // has entry-looking prose clustered in one area — reading it would
      // invent phantom classes on the wrong days.
      const cov = pageColumnCoverage(frags, cols)
      if (cov.size < 2) continue
    }
    gridFrags.push(pageFrags[frags[0].page])
    const read = readGridBoxes(frags, cols, warnings, carry)
    entries.push(...read.entries)
    carry = read.lastPeriod
  }
  if (dayCols.length < 4 && entries.length === 0) {
    return { entries: [], batches: [], subjects: [], warnings: ['No weekday heading row found in the file — add the classes by hand or paste the table as text.'] }
  }
  // The abbreviation TABLE is read from the NON-grid pages only — inside grid
  // pages those same words sit under the NOTE block and would produce false
  // matches. But grid-only codes (e.g. "ASEP(P)" cells whose row is missing
  // from the printed table) must still reach the legend fallback, so we pass
  // ALL fragments to the reader; the table pass itself re-filters per page.
  void pageFrags
  const otherFrags = pageFrags.filter((f) => !gridFrags.includes(f))
  // De-duplicated: passing the same fragments twice doubled every legend
  // name ("Computer Programming Computer Programming").
  const legendFrags = [...new Set([...otherFrags.flat(), ...all])]
  const res = finishGridParse(entries, legendFrags)
  if (skippedNoPos > 0) {
    res.warnings.push(`${skippedNoPos} text fragments had no readable position and were skipped.`)
  }
  return res
}

/** Locate the visual row(s) carrying ≥4 weekday names → column anchors.
 *  Anchors use the CENTRE of each heading fragment: cells hang around the
 *  heading, not its left edge, and using `x` biased every band ~25pt to the
 *  right (the "Tuesday classes land on Monday" symptom).
 *  Handles glued extraction rows: when one fragment holds several day names
 *  ("Time Monday Tuesday Wednesday…"), its width is split proportionally at
 *  each name's character offset, so every heading still gets an x anchor. */
export function findDayColumns(frags: Frag[]): { weekday: number; x: number }[] {
  const ys = [...new Set(frags.map((f) => f.y))].sort((a, b) => b - a)
  for (const y of ys) {
    const row = frags.filter((f) => Math.abs(f.y - y) <= 3).sort((a, b) => a.x - b.x)
    const hits: { weekday: number; x: number }[] = []
    for (const f of row) {
      const wd = DAY_HEAD_RE.test(f.str) ? weekdayFromName(f.str) : null
      if (wd !== null) { hits.push({ weekday: wd, x: (f.x + f.end) / 2 }); continue }
      // multi-day run inside one fragment — cut it into per-day anchors
      const re = /\b(mon|tues|tue|wed|thu|fri|sat|sun)(day|nesday|rsday|urday)?\b/gi
      let m: RegExpExecArray | null
      const found: { weekday: number; idx: number }[] = []
      while ((m = re.exec(f.str))) {
        const wd = weekdayFromName(m[0])
        if (wd !== null && !found.some((x) => x.weekday === wd)) found.push({ weekday: wd, idx: m.index })
      }
      if (found.length < 2) continue
      const w = Math.max(1, f.end - f.x)
      for (let i = 0; i < found.length; i++) {
        const frac = found[i].idx / Math.max(1, f.str.length)
        const nextFrac = i + 1 < found.length ? found[i + 1].idx / f.str.length : 1
        // centre of this day's slice within the run
        hits.push({ weekday: found[i].weekday, x: f.x + w * ((frac + nextFrac) / 2) })
      }
    }
    if (hits.length >= 4) return hits.sort((a, b) => a.x - b.x)
  }
  return []
}

/** Per-page day columns. Page 2+ of these grids repeats the time labels but
 *  NOT the weekday headings, and its own cell content starts further right
 *  than page 1's Monday column would allow — forcing page-2 cells into page-1
 *  bands loses the afternoon classes entirely. So: pages with their own
 *  heading row use those anchors; pages without get their headings
 *  interpolated from the observed pitch of the neighbouring pages' columns
 *  (median spacing), keeping each page in its own coordinate space. */
function dayColsByPage(pageFrags: Frag[][]): ({ weekday: number; x: number }[] | null)[] {
  const perPage = pageFrags.map((frags) => {
    const cols = findDayColumns(frags)
    return cols.length >= 4 ? cols : null
  })
  const known = perPage.filter(Boolean) as { weekday: number; x: number }[][]
  if (!known.length) return pageFrags.map(() => null)
  // median pitch between adjacent headings across all header pages
  const gaps: number[] = []
  for (const cols of known) for (let i = 1; i < cols.length; i++) gaps.push(cols[i].x - cols[i - 1].x)
  gaps.sort((a, b) => a - b)
  const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 100
  return perPage.map((cols, pi) => {
    if (cols) return cols
    // interpolate a full Mon–Sat set anchored on the average first-column x
    const avgFirst = known.reduce((s, c) => s + c[0].x, 0) / known.length
    const out: { weekday: number; x: number }[] = []
    for (let wd = 1; wd <= 6; wd++) out.push({ weekday: wd, x: avgFirst + pitch * (wd - 1) })
    void pi
    return out
  })
}

/** Does this page's content actually sit under the given column bands? Count
 *  entry-bearing fragments whose centre falls inside some column. A page whose
 *  classes cluster in only ONE column while others stand empty is not a grid
 *  page (legend/notes prose) — reading it would invent phantom classes. */
function pageColumnCoverage(frags: Frag[], dayCols: { weekday: number; x: number }[]): Set<number> {
  const colMid = (i: number): number =>
    i + 1 < dayCols.length ? (dayCols[i].x + dayCols[i + 1].x) / 2 : Infinity
  const covered = new Set<number>()
  for (const f of frags) {
    if (f.x < dayCols[0].x - 30) continue // time labels / furniture
    const s = normalizeTypeTok(f.str.trim())
    if (!ENTRY_RE.test(s)) continue
    for (let ci = 0; ci < dayCols.length; ci++) {
      if (overlapFracX(f, dayCols[ci].x - 30, colMid(ci)) >= 0.5) { covered.add(ci); break }
    }
  }
  return covered
}

/** Join split time fragments on one visual row into period ranges. */
const DASH_RE = /^[-–—]+$/
/** A clock token: "8:00", "11.15", "12.15" — but NOT bare years/rooms
 *  ("2026", "2403") which have no separator or too many digits. */
const TIME_TOKEN_RE = /^\d{1,2}[.:]\d{2}$/
/** Merge dash-split fragments: "12.15" "-" "1." "15" → {12:15→13:15};
 *  "9:00" "-10:00" → {09:00→10:00}; "4.30–5.30" stays whole. */
function extractRowTimes(parts: string[]): { start: string; end: string }[] {
  // "1. 15" / "10 :15" as one item → "1.15" / "10:15" (Div C prints its
  // 12:15 label as "12.15" "-" "1. 15"; the spaced token was not recognised
  // and the whole 12:15 period was lost).
  parts = parts.map((p) => p.replace(/^(\d{1,2})\s*([.:])\s*(\d{2})$/, '$1$2$3'))
  // Step 1: glue "N." + "NN" minute fragments into full times.
  const glued: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (/^\d{1,2}[.:]$/.test(p) && i + 1 < parts.length && /^\d{1,2}$/.test(parts[i + 1])) {
      glued.push(`${p.replace('.', ':')}${parts[++i].padStart(2, '0')}`)
    } else glued.push(p)
  }
  // Step 1b: split "H:MM[-–—]H:MM" range fragments into their two endpoints.
  // Some exports glue a whole period label into one item ("8:00 -9:00",
  // "12.15 -1. 15"); without splitting, the anchored TIME_TOKEN_RE below
  // rejects them and the page ends up with zero period bands (the
  // "DivF Monday: no classes at all" bug).
  const expanded: string[] = []
  for (const p of glued) {
    const m = /^(\d{1,2}\s*[.:]\s*\d{2})\s*[-–—]+\s*(\d{1,2}\s*[.:]\s*\d{2})$/.exec(p.trim())
    // strip inner spaces ("1. 15" → "1.15") so the endpoints read as clock tokens
    if (m && m[1] !== m[2]) expanded.push(m[1].replace(/\s+/g, ''), '-', m[2].replace(/\s+/g, ''))
    else expanded.push(p)
  }
  glued.length = 0
  glued.push(...expanded)
  // Step 2: collect clock tokens in order; a fragment that itself contains a
  // dash between two clock numbers contributes BOTH endpoints.
  const times: string[] = []
  // A lone dash fragment is only a period separator when it sits between two
  // clock tokens ("10:15" "–" "11:15"). Div F's header page prints the time
  // column with em-dashes that have NO following time ("8:00 –", "9:00 –"):
  // skipping those dashes made every row look like an unpaired half-time and
  // the whole page collapsed to zero periods (the "DivF: 0 entries" bug).
  const sepAt = (i: number): boolean =>
    DASH_RE.test(glued[i]) && i + 1 < glued.length && TIME_TOKEN_RE.test(glued[i + 1])
  for (let i = 0; i < glued.length; i++) {
    const p = glued[i]
    if (DASH_RE.test(p)) {
      if (!sepAt(i)) continue // decorative dash, not part of a range
      // "start" "-" "end": push start from previous token, end from next
      const prev = times.length ? undefined : undefined
      void prev
      const m2 = /^(\d{1,2}[.:]\d{2})\s*[-–—]$/.exec(glued[i - 1] ?? '')
      const endTok = glued[i + 1]
      if (m2) { times.push(m2[1], endTok); i++ ; continue }
      if (/^[-–—]\s*\d{1,2}[.:]\d{2}$/.test(p)) { times.push(p.replace(/^[-–—]\s*/, '')); continue }
      // bare dash between two plain time tokens — pair them
      if (times.length && TIME_TOKEN_RE.test(endTok)) { times.push(endTok); i++; continue }
      continue
    }
    const m = /(\d{1,2}[.:]\d{2})\s*[-–—]\s*(\d{1,2}[.:]\d{2})/.exec(p)
    if (m) { times.push(m[1], m[2]); continue }
    const lead = /^(\d{1,2}[.:]\d{2})\s*[-–—]/.exec(p)
    if (lead) {
      // trailing dash with no printed end time ("8:00 –") → keep as start;
      // pairing happens against the next row's start below
      if (/^(\d{1,2}[.:]\d{2})\s*[-–—]$/.test(p)) { times.push(lead[1]); continue }
      times.push(lead[1]); continue
    }
    const trail = /^\s*[-–—]\s*(\d{1,2}[.:]\d{2})$/.exec(p)
    if (trail) { times.push(trail[1]); continue }
    if (TIME_TOKEN_RE.test(p)) times.push(p)
  }
  // Step 3: pair them up.
  const norm = (s: string): string | null => {
    // Accept "8:00", "11.15" AND the space-split spellings pdf.js emits on
    // some exports ("1. 15", "10: 15") — Div F prints its afternoon periods
    // with a space after the dot, and rejecting those made every band from
    // 12:15 onward vanish (the "DivF: 0 entries" bug).
    const m = /^(\d{1,2})\s*[.:]\s*(\d{2})$/.exec(s.trim())
    if (!m) return null
    const h = Number(m[1]), mi = Number(m[2])
    if (h > 23 || mi > 59) return null
    return `${String(collegeHour(h)).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  }
  const out: { start: string; end: string }[] = []
  for (let i = 0; i + 1 < times.length; i += 2) {
    const a = norm(times[i]), b = norm(times[i + 1])
    if (a && b && a !== b) out.push({ start: a, end: b })
  }
  return out
}

/** Read every (period band × day column) box on one grid page. */
/** Read every (period band × day column) box on one grid page.
 *  `carry` is the previous page's last class period: on a continuation page,
 *  class rows printed ABOVE the first time label are the tail of that period's
 *  cells (a two-hour lab block broken across the page). Returns the entries
 *  plus this page's last class period for the next page. */
export function readGridBoxes(
  allFrags: Frag[],
  dayCols: { weekday: number; x: number }[],
  warnings: string[],
  carry: { start: string; end: string } | null = null,
): { entries: ParsedEntry[]; lastPeriod: { start: string; end: string } | null } {
  // Only this page's fragments participate — `frags` arrives as one page's list,
  // but guard anyway so a pooled array can never mix coordinate spaces.
  const homePage = allFrags[0]?.page ?? 0
  const frags = allFrags.filter((f) => f.page === homePage)

  // ---- T3: period rows anchored at the leftmost column ----
  /** `label` is the y of the period's time label; yTop/yBottom bound its cell box. */
  interface Band { start: string; end: string; yTop: number; yBottom: number; page: number; label: number; carried?: boolean }
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
      rawBands.push({ start: t.start, end: t.end, yTop: y, yBottom: y, page: pg, label: y })
    }
  }
  // Merge bands that sit within ~5pt of each other on the same page: pdf.js
  // can emit two nearly-identical time rows for one period (e.g. "12.15" and
  // "12:15"), which would otherwise create duplicate periods.
  rawBands.sort((a, b) => b.page - a.page || b.yTop - a.yTop)
  const merged: Band[] = []
  for (const b of rawBands) {
    const prev = merged.length ? merged[merged.length - 1] : null
    if (prev && prev.page === b.page && Math.abs(prev.yTop - b.yTop) <= 5) {
      // Same visual row. Two different time labels side by side on one row
      // ("2:15 - 3:15" and "3.15 – 4.15") are SIBLING periods whose cells sit
      // in DIFFERENT day columns; giving them separate overlapping bands makes
      // each cell get claimed by both periods (duplicate classes). Merge them
      // into one band covering both labels — parseCellEntries then emits one
      // entry per column cell with the correct period times. Only true
      // duplicates of the SAME range collapse here; everything else keeps
      // distinct bands.
      if (prev.start === b.start && prev.end === b.end) {
        prev.yBottom = Math.min(prev.yTop, b.yTop)
      } else if (prev.start === b.start || prev.end === b.end) {
        // Same period printed twice on one row with slightly different end
        // spellings ("8:00-9:00" + "8:00-9.00"): collapse to the first label's
        // range instead of inventing a merged "8:00–9.00" phantom period.
        prev.yBottom = Math.min(prev.yTop, b.yTop)
      } else {
        prev.start = prev.start < b.start ? prev.start : b.start
        prev.end = prev.end > b.end ? prev.end : b.end
        prev.yBottom = Math.min(prev.yTop, b.yTop)
      }
      continue
    }
    // A time label that is EXACTLY another band's end time is a misread
    // duplicate of the shared boundary — e.g. Div F prints "10:15 – 11:15"
    // and then, 6pt lower, "11:15 – 12:15": the lone "11:15" sits in both
    // labels and the extractor re-emits it as the next row's start. Real
    // grids never stack periods back-to-back at the same y pitch (~17pt),
    // so when two adjacent rows share an endpoint AND sit within 10pt, drop
    // the lower one (it would otherwise steal the upper period's cells and
    // duplicate every class in them).
    if (merged.length) {
      const near = merged[merged.length - 1]
      if (near.page === b.page && Math.abs(near.yTop - b.yTop) <= 10 &&
          (b.start === near.end || b.end === near.start)) continue
    }
    merged.push(b)
  }
  const uniqBands = merged

  // ---- Period boxes ------------------------------------------------------
  // Every period's cell block is printed vertically CENTRED on its time
  // label: stacked batch rows sit both above and below the label baseline
  // (Div A 8:00: A1 @+14, A2 on the label row, A3 @-14). So each text row
  // belongs to the class period whose label is vertically closest, i.e. the
  // box boundary between two adjacent periods is the midpoint of their
  // labels. Break periods (Short Break / LUNCH BREAK rows) hold no cells and
  // are left out of the midpoint computation so they never steal the
  // neighbouring periods' rows. The first/last period of a page extends by
  // the same half-gap on its open side.
  //
  // The old rule set each box bottom to `next.yTop - 12` — BELOW the next
  // label, since PDF y grows upward — so every period also swallowed the
  // upper half of the following period and its classes were emitted twice
  // (e.g. a 9:00 class also showing at 8:00).
  const breakSet = new Set(uniqBands.filter((b) => isBreakBand({ ...b, yTop: b.label }, frags)))
  for (const pg of new Set(uniqBands.map((b) => b.page))) {
    const classBands = uniqBands
      .filter((b) => b.page === pg && !breakSet.has(b))
      .sort((a, b) => b.yTop - a.yTop)
    const labelY = classBands.map((b) => b.label)
    classBands.forEach((b, i) => {
      const up = i > 0 ? (labelY[i - 1] - labelY[i]) / 2 : null
      const down = i + 1 < labelY.length ? (labelY[i] - labelY[i + 1]) / 2 : null
      const half = (fallback: number | null) => fallback ?? 30
      b.yTop = labelY[i] + half(up ?? down)
      b.yBottom = labelY[i] - half(down ?? up)
    })
  }
  const classBandsAll = uniqBands.filter((b) => !breakSet.has(b))
  const hasOwnHeader = findDayColumns(frags).length >= 4
  if (carry && !hasOwnHeader && classBandsAll.length) {
    const topBand = classBandsAll.reduce((a, b) => (b.yTop > a.yTop ? b : a))
    uniqBands.push({ start: carry.start, end: carry.end, yTop: Infinity, yBottom: topBand.yTop, page: topBand.page, label: topBand.yTop, carried: true })
  }


  const proseCutByPage = new Map<number, number>()
  for (const b of uniqBands) {
    if (proseCutByPage.has(b.page)) continue
    const pageBands = uniqBands.filter((o) => o.page === b.page)
    const lowestBandY = Math.min(...pageBands.map((o) => o.label))
    const noteFrag = frags.find(
      (f) => f.page === b.page && f.y < lowestBandY - 6 && /NOTE\s*:?/i.test(f.str),
    )
    proseCutByPage.set(b.page, noteFrag ? noteFrag.y + 8 : -Infinity)
  }

  // ---- T4/T6: read every (period band × day column) box ----
  const out: ParsedEntry[] = []
  // Column bands: the left edge sits just left of the day heading; the right
  // edge is the MIDPOINT between adjacent headings. The old rule (next
  // heading minus 20) cut cells short, so the last fragment of a cell — often
  // a wrapped room number like "2408" at x≈611 under Friday — fell into the
  // next day's column and classes appeared shifted onto the wrong weekday.
  const colMid = (i: number): number =>
    i + 1 < dayCols.length ? (dayCols[i].x + dayCols[i + 1].x) / 2 : Infinity
  for (const band of uniqBands) {
    // Break periods (short break / lunch) never hold classes — skip the whole
    // row. Wrapped room numbers or teacher initials that visually fall inside
    // the break box used to be re-emitted as a "10:00" class duplicating the
    // real 10:15 one.
    if (breakSet.has(band)) continue
    for (let ci = 0; ci < dayCols.length; ci++) {
      // Columns tile the row: each starts where the previous one ends. The
      // old fixed `x - 30` left edge left gaps between columns, so narrow
      // cells printed near a column's left side (Div A's Monday "ASEP(P)")
      // belonged to no day at all and were silently dropped.
      const lo = ci > 0 ? colMid(ci - 1) : dayCols[0].x - (dayCols.length > 1 ? (dayCols[1].x - dayCols[0].x) / 2 : 30)
      const hi = colMid(ci)
      const inBox = frags.filter(
        (f) =>
          f.page === band.page &&
          f.y <= band.yTop &&
          f.y > Math.max(band.yBottom, proseCutByPage.get(band.page) ?? -Infinity) &&
          overlapFracX(f, lo, hi) >= 0.5,
      )
      if (inBox.length === 0) continue
      // A break label ANYWHERE inside this cell box means the whole cell is a
      // break ("Short Break" / "LUNCH BREAK" printed across the row). Real
      // grids never mix a class and a break in one cell, so skip it — this
      // kills the phantom "10:00-10:15 SDC" duplicates produced when a break
      // row's wrapped room number fell into the period band above/below.
      const boxText = inBox.map((f) => normalizeTypeTok(f.str)).join(' ')
      if (BREAK_TEXT_RE.test(boxText) && !ENTRY_RE.test(normalizeTypeTok(boxText.replace(BREAK_TEXT_RE, ' ')))) continue
      const lines = stitchCellFrags(inBox)
      for (const text of lines) {
        const nt = normalizeTypeTok(text)
        if (BREAK_TEXT_RE.test(nt) && !/\(\s*[LPTS]\s*\)/.test(nt)) continue // T8
        if (PROSE_RE.test(nt)) continue // NOTE/legend prose under the grid
        // Above the first label of a continuation page only real class rows
        // count — the page-header furniture lives there too.
        if (band.carried && !/\(\s*[LPTS]\s*\)/.test(nt)) continue
        // A cell line whose every entry is an untagged subject with neither
        // teacher nor room is almost always wrapped furniture from the
        // neighbouring period ("2407" continuation rows landing here). Keep
        // it only when at least one fragment carries real entry payload.
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
  const lastClass = classBandsAll.length ? classBandsAll.reduce((a, b) => (b.label < a.label ? b : a)) : null
  return { entries: out, lastPeriod: lastClass ? { start: lastClass.start, end: lastClass.end } : carry }
}

/** All fragments of one cell box joined into a single string (top→bottom). */
function bandText(frags: Frag[]): string {
  return bandLines(frags).join(' ')
}

/** Shared tail of the grid parse: batch tags, de-dupe, legend, warnings. */
function finishGridParse(rawEntries: ParsedEntry[], frags: Frag[]): GridParseResult {
  const warnings: string[] = []
  const subjects = readLegend(frags)
  // Legend-based repair: PDF column rules can split a code ("VACO-I" →
  // "VACO"+"I", "ASEP" → "ASE"+"P") or bleed a day-column's leading batch
  // tag into the neighbour cell ("F SD C (L)"). Try to fix those against
  // the printed abbreviation table BEFORE de-duping, so repaired twins
  // collapse instead of showing up as two phantom classes.
  const legendCodes = new Set(subjects.map((s) => normalizeSubjectShort(s.short)))
  // Repair pass 1: batch-tag bleed ("F SD C (L)") and hyphen-chopped codes.
  for (const e of rawEntries) repairSplitSubject(e, legendCodes)
  // Repaired twins collapse: "A VACO-I" and "VACO-I" are the same class read
  // twice from one cell — when two entries share subject+type+day+time and
  // at least one is untagged, treat single-division letters as non-batches
  // so the existing same-batch dedupe merges them into one row.
  const cellSeen = new Map<string, string | null>()
  for (const e of rawEntries) {
    if (!e.startTime || e.needsReview) continue
    const tag = e.batch && e.batch.length > 1 ? e.batch : null
    const key = `${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
    const prev = cellSeen.get(key)
    if (prev !== undefined && tag === prev) e.dropped = true
    else cellSeen.set(key, tag)
  }
  const batches = distinctBatches(rawEntries.filter((e) => !e.dropped))
  const entries: ParsedEntry[] = []
  // De-dupe per day, but keep a period's stacked batch rows intact: two
  // batches can genuinely share subject+type+time in one cell ("A1 CP (L)"
  // above "A2 CP (L)"). When that happens, require the NEXT occurrence to
  // carry a different batch tag — otherwise it is a duplicate emitted by an
  // overlapping band and must be dropped. Rows with no tag never block others.
  // Entries missing teacher AND room are continuation noise (a wrapped room
  // row landing inside the wrong box) — drop them when the same day/period
  // already has a fully-attributed entry for that subject+type.
  const isNoise = (e: ParsedEntry): boolean =>
    !e.batch && !e.teacher && !e.room &&
    rawEntries.some(
      (o) => o !== e && o.subjectShort === e.subjectShort && o.type === e.type &&
        o.weekday === e.weekday && o.startTime === e.startTime && (o.teacher || o.room),
    )
  const seen = new Map<string, string | null>()
  for (const e of rawEntries) {
    if (isNoise(e) || e.dropped) continue
    const key = `${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
    const prevBatch = seen.get(key)
    if (prevBatch !== undefined && (e.batch ?? null) === prevBatch) continue
    seen.set(key, e.batch ?? null)
    entries.push(e)
  }
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

/**
 * Robust file entry point: given the raw text and/or per-page positioned items
 * extracted from an uploaded file, pick whichever representation can actually
 * produce entries. PDFs whose `.text()` view is binary junk still parse via
 * `pages`; pasted/CSV text still parses via `text`. Returns the result plus
 * which channel produced it (for UI messaging).
 */
export function parseTimetableUpload(input: {
  text?: string
  pages?: TextItemLike[][] | null
}): { result: GridParseResult | ImportResult; via: 'grid' | 'text' | 'none' } {
  const text = input.text ?? ''
  const pages = input.pages ?? null
  if (pages && pages.length) {
    const g = parseTimetablePages(pages)
    if (g.entries.length > 0) return { result: g, via: 'grid' }
    // Positioned extraction yielded nothing usable — keep the grid warnings
    // but still try the line-based reader before giving up.
    const t = parseTimetableText(text)
    if (t.entries.length > 0) return { result: t, via: 'text' }
    return { result: g, via: 'none' }
  }
  const t = parseTimetableText(text)
  if (t.entries.length > 0) return { result: t, via: 'text' }
  return { result: t, via: 'none' }
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
    const key = `${e.batch ?? '∅'}|${e.subjectShort}|${e.type}|${e.weekday}|${e.startTime}`
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
  // A legend row needs a subject CODE fragment on the same page; grid pages
  // have bare numbers too (times like "10", rooms) but no code column, so
  // requiring one here keeps NOTE-block words from becoming phantom subjects.
  const hasCodeRe = /^[A-Z]{2,6}(?:-[IVX]+)?$/
  // Column geometry per page. Read from the table's own header row ("S.N." |
  // "Course abbreviation" | "Course Name" | "Teacher-name initials") when it
  // is present: the old fixed x positions only fit Div A's page size, so on
  // larger pages (Div F is printed ~1.9× wider) no legend row was ever read
  // and every subject came out named after its code.
  interface Geo { snMaxX: number; codeMaxX: number; teacherLo: number; rowTol: number; nearTol: number }
  const geoByPage = new Map<number, Geo>()
  for (const [pg, arr] of byPage) {
    const sn = arr.find((f) => /^S\.?\s*N\.?$/i.test(f.str.trim()))
    const hdr = sn ? arr.filter((f) => Math.abs(f.y - sn.y) <= 8 && f.x > sn.x).sort((a, b) => a.x - b.x) : []
    const abbr = hdr.find((f) => /abbrev/i.test(f.str))
    const name = hdr.find((f) => /course\s*name|^name$/i.test(f.str.trim()))
    const teacher = hdr.find((f) => /teacher/i.test(f.str))
    if (sn && abbr && teacher && teacher.x > sn.x) {
      const scale = (teacher.x - sn.x) / 370 // 370 ≈ S.N.→Teacher distance on the Div A page
      geoByPage.set(pg, {
        snMaxX: abbr.x,
        codeMaxX: name ? name.x : abbr.end + 40 * scale,
        teacherLo: teacher.x - 15 * scale,
        rowTol: 6 * scale,
        nearTol: 14 * scale,
      })
    } else {
      geoByPage.set(pg, { snMaxX: 110, codeMaxX: NAME_COL_LO, teacherLo: TEACHER_COL_X, rowTol: 6, nearTol: 14 })
    }
  }
  const snRows: Frag[] = []
  for (const [pg, arr] of byPage) {
    if (!arr.some((f) => hasCodeRe.test(f.str))) continue
    const geo = geoByPage.get(pg)!
    arr
      .filter((f) => /^\d{1,2}$/.test(f.str) && f.x < geo.snMaxX)
      .sort((a, b) => b.y - a.y)
      .forEach((f) => snRows.push(f))
  }
  snRows.sort((a, b) => a.page - b.page || b.y - a.y)
  for (const sn of snRows) {
    const pageFrags = byPage.get(sn.page)!
    const geo = geoByPage.get(sn.page)!
    // Rows are ~13pt apart; ±8 would bleed into the neighbour row and pull
    // in another subject's words (e.g. "SDC … Calculus JSA Jameel S. Ansari").
    const row = pageFrags
      .filter((f) => Math.abs(f.y - sn.y) <= geo.rowTol && f.x > sn.end)
      .sort((a, b) => a.x - b.x)
    const codes = row.filter((f) => CODE_RE.test(f.str) && f.x < geo.codeMaxX)
    if (codes.length === 0) continue
    const codeCol = codes[0]
    // Full name: words strictly between the abbreviation column and the
    // teacher-initials column. Wrapped names put the second line slightly
    // below the anchor row (PDF y grows up), e.g. "Statistics and
    // Differential" at y+7 with "Calculus" at y-7 — so look both ways.
    const nearRow = pageFrags
      .filter((f) => Math.abs(f.y - sn.y) <= geo.nearTol && f.x > codeCol.end && f.x < geo.teacherLo)
      .sort((a, b) => b.y - a.y || a.x - b.x)
    const words: string[] = []
    let lastY: number | null = null
    for (const f of nearRow) {
      if (lastY !== null && Math.abs(f.y - lastY) > 3) words.push(' ') // line break
      // A fragment may carry one word or a whole run ("Computer Programming").
      for (const w of f.str.trim().split(/\s+/)) if (/^[A-Za-z][A-Za-z&,.']*$/.test(w)) words.push(w)
      lastY = f.y
    }
    const full = words
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+(\w)/, (_, c: string) => ' ' + c)
      .replace(/\b(\w+)(?: \1\b)+/g, '$1') // "orientation I I" (code suffix read twice) → "orientation I"
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
  // The type marker is REQUIRED: a bare uppercase word in the grid is just as
  // likely teacher initials ("KRP") or a break label ("LUNCH", "BREAK"), and
  // those used to be offered as phantom subjects.
  const GRID_CODE_RE = /^([A-Z]{2,6})\s*\(\s*[LPTS]\s*\)$/
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

/**
 * Repair a mis-split subject code using the abbreviation legend as ground
 * truth. Two failure shapes seen in the real PDFs:
 *  - column rules chop a code: "VACO-I" → "-C"/"-E" (hyphen split),
 *    "ASEP" → "ASE"/"AS", leaving a stray fragment;
 *  - the neighbour day-column's batch tag bleeds in: "F SD C (L)".
 * Only fires when the repaired code exists in the legend AND another entry
 * in the same cell region already carries it — otherwise leave the entry
 * flagged for manual review. Mutates `e` in place and returns whether it
 * changed anything.
 */
function repairSplitSubject(e: ParsedEntry, legendCodes: Set<string>): boolean {
  if (!legendCodes.size) return false
  const raw = e.raw ?? ''
  const subj = e.subjectShort.toUpperCase()
  // Case 1: leading batch letter bled from the previous day column,
  // e.g. raw "F SD C (L)" or "F1 S(L)" with parsed subject "S"/"-".
  const bleed = raw.match(/^([A-Z](?:[1-9])?)\s+(.+)$/)
  if (bleed && !e.batch) {
    const cand = bleed[2].replace(/[^A-Z0-9-]/gi, '').toUpperCase()
    const norm = normalizeSubjectShort(cand)
    if (legendCodes.has(norm)) {
      e.batch = bleed[1]
      e.subjectShort = cand
      e.needsReview = false
      return true
    }
  }
  // Case 2: hyphen-chopped code — "-C(T)" is really "SDC(T)"-style tail.
  // Rebuild by gluing single-letter fragments around the type marker.
  if (/^-/.test(subj) || subj.length <= 2) {
    const glued = raw
      .replace(/\(([LPTS])\)/gi, '($1)')
      .match(/((?:[A-Z](?![LPTS]\)))[- ]?){2,6}\s*\([LPTS]\)/i)
    if (glued) {
      const cand = glued[0].split('(')[0].replace(/[^A-Z0-9-]/gi, '').toUpperCase()
      const norm = normalizeSubjectShort(cand)
      if (cand.length >= 3 && legendCodes.has(norm)) {
        e.subjectShort = cand
        e.needsReview = false
        return true
      }
    }
  }
  return false
}

/** Turn confirmed review entries into Slots (subjects must already exist by short name). */
export function entriesToSlots(
  entries: ParsedEntry[],
  subjectIdByShort: Map<string, string>,
  validFrom: DateStr,
): { slots: Omit<Slot, 'id'>[]; unmatched: ParsedEntry[] } {
  const slots: Omit<Slot, 'id'>[] = []
  const unmatched: ParsedEntry[] = []
  // Last-resort repair against the REAL subject list (which includes codes
  // that aren't in the printed legend, e.g. "FE"): a cell whose code was
  // chopped by a column rule ("F E", "-E") or prefixed by a bleeding batch
  // tag ("A VACO-I") is matched back to an existing subject when exactly
  // one candidate fits — unambiguous, so never wrong-days a class.
  const shorts = [...subjectIdByShort.keys()]
  for (const e of entries) {
    if (e.dropped) continue
    const norm = normalizeSubjectShort(e.subjectShort)
    // Exact code first: the import creates subject "VACO-I", and looking it
    // up only by the suffix-stripped "VACO" silently dropped every such class.
    let id = subjectIdByShort.get(e.subjectShort.toUpperCase()) ?? subjectIdByShort.get(norm)
    if (!id) {
      const compact = norm.replace(/[^A-Z0-9]/g, '')
      const cands = shorts.filter((s) => {
        const sc = s.replace(/[^A-Z0-9]/g, '')
        return sc === compact || (compact.length >= 2 && sc.endsWith(compact)) ||
          (sc.length >= 2 && compact.endsWith(sc))
      })
      if (cands.length === 1) {
        id = subjectIdByShort.get(cands[0])
        e.subjectShort = cands[0]
        e.needsReview = false
      }
    }
    if (!id || !e.weekday || !e.startTime) { unmatched.push(e); continue }
    slots.push({
      subjectId: id,
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
