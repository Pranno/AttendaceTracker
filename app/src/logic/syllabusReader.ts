// ============================================================
// Syllabus reader — rules S1–S18 and L1–L6 (requirements doc,
// "Reading rules (no AI)"). Runs on the phone, works offline.
//
// Input:  selectable text from the college syllabus PDF, kept with its
//         line layout (S1). pdfjs items carry an x/y position; grouping
//         by y restores lines and the x ranges restore table columns.
// Output: subjects → units (number, title, hours, topics) and course
//         links (name, platform, url, CO, unit) for the review screen.
//         Nothing is saved until the user confirms (E2 / accuracy rule).
// ============================================================

import type { CourseLink } from '../data/model'

export interface ParsedTopic {
  name: string
  /** S14 group heading this topic sits under ("Astronomy:", "Mathematics:") */
  group?: string
  /** S17: over 12 words — probably several topics run together; flag orange */
  needsSplit: boolean
}

export interface ParsedUnit {
  number: number
  title: string
  hours: number
  topics: ParsedTopic[]
  /** S5/S7: something was unclear → flagged, never guessed (A5-style) */
  needsReview: boolean
}

export interface ParsedCourseLink {
  name: string
  platform: string
  url: string
  coNumber?: string
  /** Unit label from the Springboard table, when present */
  unitLabel?: string
  unitNumber?: number
  /** L4: rebuilt or flagged "check link" */
  needsChecking: boolean
  /** L5: not an Infosys Springboard link */
  otherSite: boolean
  /** L6: a course with no link at all */
  noLink: boolean
}

export interface ParsedSyllabusSubject {
  code: string
  fullName: string
  shortName: string
  units: ParsedUnit[]
  links: ParsedCourseLink[]
  /** S18: id of the existing subject this matched to, if any */
  matchedSubjectId?: string
}

export interface SyllabusParseResult {
  subjects: ParsedSyllabusSubject[]
  /** S1: no selectable text found */
  scanned: boolean
}

// ---------------- S1: text with line layout ----------------

export interface TextItemLike {
  str: string
  transform: number[]
  width?: number
}

export interface LineItem {
  x: number
  end: number
  str: string
  /** Raw vertical position before rounding (used by the timetable grid
   *  reader, which needs sub-pixel y values for band boundaries). */
  rawY?: number
}
export interface Line {
  y: number
  /** Which page (0-based) this line came from — sections never span pages. */
  page: number
  items: LineItem[]
}

/** Group pdfjs text items into visual lines (same baseline y), sorted top→down,
 *  items left→right. Rows that are within 3px of each other merge — table cell
 *  text often sits a pixel or two off the header baseline (e.g. superscript "th"
 *  in "12th edition" lands on its own near-baseline otherwise).
 *
 *  `page` is the 0-based index of THIS batch's page. Every PDF page restarts
 *  its y-axis at the bottom, so the same rounded y on two different pages is
 *  not the same visual line — merging them would interleave content from both
 *  pages. Callers with several pages must pass a distinct `page` per batch
 *  (see parseSyllabusPages) or concatenate batches only after grouping. */
export function groupItemsIntoLines(items: TextItemLike[], page = 0): Line[] {
  // Guard against items with missing/short transform arrays (see timetable
  // reader): such items are dropped rather than crashing the grouping.
  const real = items.filter(
    (it) => it.str && it.str.trim() && Array.isArray(it.transform) && it.transform.length >= 6,
  )
  // sort by descending y so the first row anchors each band
  const sorted = [...real].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
  const lines: Line[] = []
  for (const it of sorted) {
    const y = it.transform[5]
    const w = (it.width ?? 0) || Math.max(1, it.str.length * 4)
    const entry = {
      x: Math.round(it.transform[4]),
      end: Math.round(it.transform[4]) + Math.round(w),
      str: it.str,
      rawY: y,
    }
    let ln: Line | undefined
    for (const cand of lines) {
      if (cand.page !== page) continue
      if (Math.abs(cand.y - y) <= 3) { ln = cand; break }
    }
    if (!ln) {
      ln = { y: Math.round(y), page, items: [] }
      lines.push(ln)
    }
    ln.items.push(entry)
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => b.y - a.y)
}

/** Parse a whole document given as one item-array per page (as produced by
 *  pdfjs getTextContent per page). Lines are grouped inside each page — the
 *  same y on two different pages is not the same line. */
export function parseSyllabusPages(pages: TextItemLike[][]): SyllabusParseResult {
  const allLines: Line[] = []
  pages.forEach((pg, pi) => allLines.push(...groupItemsIntoLines(pg, pi)))
  return parseSyllabusLines(allLines)
}

/** Plain-text input (pasted syllabus): every non-empty line becomes a one-item
 *  line with unknown columns. The reader still finds course codes, unit
 *  headers, hours and topics; column-based tables just won't be split. */
export function linesFromPlainText(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ y: 1000 - i, page: 0, items: [{ x: 0, end: t.length * 6, str: t }] }))
}

// ---------------- S2: repeated page furniture ----------------

/** Header/footer fragments that repeat on every page. Matched against each
 *  fragment of a line, not the joined line — because grouping merges the whole
 *  header band ("Vishwakarma University, Pune" + "Issue 01…" + running title)
 *  into one visual line. A line is furniture when EVERY fragment is furniture
 *  (so real content sharing a baseline with the running title survives). */
const FURNITURE_PATTERNS: RegExp[] = [
  /Vishwakarma University/i,
  /Issue\s*\d+\s*[:.]?\s*Rev\s*No/i,
  /^Form\s*No:/i,
  /^Faculty of Science and Technology$/i,
  /^Programme Structure(&| and) Syllabus$/i,
  /^B\.?Tech Computer Science and Engineering \d{4}$/i,
  /^Title: .*Programme Structure and Syllabus/i,
]

export function isFurnitureLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  return FURNITURE_PATTERNS.some((re) => re.test(t))
}

/** True when every fragment of the line matches a furniture pattern. */
function isFurnitureItems(items: { str: string }[]): boolean {
  const frags = items.map((it) => it.str.trim()).filter(Boolean)
  if (frags.length === 0) return true
  return frags.every((f) => isFurnitureLine(f))
}

// ---------------- Column model ----------------

/** Fixed x boundaries between table columns (measured on the Sem-1 PDF).
 *  A text item belongs to the LAST column whose start is ≤ its start — the
 *  old rule. The new rule additionally lets a WIDE fragment belong to the
 *  column where most of its width lands, which is what happens with merged
 *  table cells ("UNIT NO.01 <tab> TITLE <tab> 08 Hours" all printed as one
 *  long fragment starting in the Unit column). */
const COL_BOUNDS = [0, 34, 144, 328, 507, 533, 545, Infinity]

/** Fraction of an item's horizontal span that falls inside [a, b]. */
function overlapFrac(x: number, end: number, a: number, b: number): number {
  const w = Math.max(1, end - x)
  const ov = Math.max(0, Math.min(end, b) - Math.max(x, a))
  return ov / w
}

/** The column a fragment belongs to: its start column, or — when more than
 *  half of its width lies to the right of the next boundary — that later
 *  column. Returns the last plausible column for very wide fragments only
 *  up to the column containing ≥50% of the width. */
export function colOfFragment(x: number, end: number): number {
  let best = 0
  let bestFrac = -1
  for (let c = 0; c < COL_BOUNDS.length - 1; c++) {
    const a = COL_BOUNDS[c]
    const b = COL_BOUNDS[c + 1] === 0 ? Infinity : COL_BOUNDS[c + 1]
    if (!Number.isFinite(b) && c === COL_BOUNDS.length - 2) {
      // last open-ended column: takes everything from its start onward
      if (x >= a) return c
      continue
    }
    const f = overlapFrac(x, end, a, b)
    if (f > bestFrac) {
      bestFrac = f
      best = c
    }
  }
  const startCol = (() => {
    for (let i = COL_BOUNDS.length - 1; i >= 0; i--) if (x >= COL_BOUNDS[i]) return i
    return 0
  })()
  // prefer the majority-width column, but never move LEFT of the start column
  return Math.max(startCol, best)
}

/** Column band edges from the fixed grid. */
const bandEdge = (col: number): number => (col >= COL_BOUNDS.length - 1 ? Infinity : COL_BOUNDS[col])

/** Items of a line that lie inside columns [c0, c1], joined in reading order.
 *  An item counts when its assigned column (see colOfFragment) is in range. */
function cellText(line: Line, c0: number, c1: number): string {
  const parts: string[] = []
  for (const it of line.items) {
    const c = colOfFragment(it.x, it.end)
    if (c >= c0 && c <= c1) parts.push(it.str)
  }
  return joinFragments(parts)
}

function joinFragments(parts: string[]): string {
  let out = ''
  for (const raw of parts) {
    const p = raw.trim()
    if (!p) continue
    if (!out) {
      out = p
      continue
    }
    const prev = out[out.length - 1]
    const next = p[0]
    const glue = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next) ? ' ' : ''
    out += glue + p
  }
  return out.replace(/\s+/g, ' ').replace(/ \./g, '.').trim()
}

// ---------------- S3: subject headers ----------------

const SUBJECT_CODE_RE = /^([A-Z][A-Z0-9/_-]{4,}\d[A-Z0-9]*)\s*:\s*(.+)$/
/** Bare course code as it appears in the programme-structure grid (no colon). */
const BARE_CODE_RE = /^[A-Z][A-Z0-9/_-]{4,}\d[A-Z0-9]*$/

// ---------------- S5/S6/S7/S8: unit headers ----------------

/** S5 — every spelling the document uses for a unit header on ONE line:
 *  "UNIT NO.01", "Unit No.01", "Unit No 1", "Unit No. 01 …". */
const UNIT_HEAD_RE = /^unit\s*(?:no\.?|number)?\s*(\d+)\b(.*)$/i
/** S6: "Unit" alone on one line, "No.01 …" on the next. */
const UNIT_SPLIT_RE = /^no\.?\s*(\d+)\b(.*)$/i
/** "Unit No" with the number in the NEXT table column. */
const UNIT_NOCOL_RE = /^unit\s*(?:no\.?|number)?$/i

/** S7: hours = the number next to the word "Hours"; if the word is missing,
 *  the first lone number ≥ 2 in the tail. */
function extractHours(tail: string): { hours: number | null; rest: string; ambiguous: boolean } {
  const t = tail.trim()
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-\s*\d+\s*)?(?:hrs?|hours?|hr\.?\/week)/i)
  if (m) return { hours: Number.parseInt(m[1], 10), rest: t.replace(m[0], ' '), ambiguous: false }
  m = t.match(/(?:hrs?|hours?)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i)
  if (m) return { hours: Number.parseFloat(m[1]), rest: t.replace(m[0], ' '), ambiguous: false }
  m = t.match(/(?:^|\s)(\d{1,2})(?=\s|$)/)
  if (m) return { hours: Number.parseInt(m[1], 10), rest: t.replace(m[0], ' '), ambiguous: true }
  return { hours: null, rest: t, ambiguous: false }
}

/** S9: drop table-column leftovers beside the unit text. */
function cleanUnitTitle(s: string): string {
  return s
    .replace(/\b(CO|BT|BTL|POs?|PSOs?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,:;-]+$/, '')
    .trim()
}

/** A title cell must look like a heading: mostly capital words, not a sentence. */
function looksLikeHeading(s: string): boolean {
  const t = s.replace(/^(?:title|course content)\s*:/i, '').trim()
  if (!t || t.length > 90) return false
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  if (words.length === 0 || words.length > 8) return false
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length
  return caps >= Math.ceil(words.length * 0.6)
}

// ---------------- S10–S16: topic splitting ----------------

/** S10: join a word broken across lines with a hyphen. In this syllabus every
 *  "x- y" (hyphen + space) is a wrap artifact — real compounds print tight
 *  ("peer-to-peer") — so "Server- Side" → "ServerSide". Applied to the joined
 *  buffer before splitting, and per-piece as a safety net. */
function dehyphenate(text: string): string {
  return text.replace(/([A-Za-z0-9])-\s+([A-Za-z0-9])/g, (_all, a, b) => `${a}${b}`)
}

/** Depth-aware split helper: returns the separator positions in `text` that
 *  lie outside brackets. A comma between two bare words with no space after it
 *  ("Multilevel,Hierarchical") is a missing-space typo inside one topic — keep
 *  it and normalise to ", ". */
function splitPoints(text: string, seps: RegExp): number[] {
  const pts: number[] = []
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (depth > 0) continue
    if (seps.test(ch)) {
      const prevCh = text[i - 1] ?? ''
      const nextCh = text[i + 1] ?? ''
      if (ch === ',' && nextCh !== ' ' && /[A-Za-z]/.test(prevCh) && /[A-Za-z]/.test(nextCh)) continue
      pts.push(i)
    }
  }
  return pts
}

/** Insert a space after commas that lack one ("Multilevel,Hierarchical"). */
function fixCommaSpacing(s: string): string {
  return s.replace(/,([^\s),\]])/g, ', $1')
}

/** Cut `text` at the given positions, dropping the separator char. */
function cutAt(text: string, pts: number[]): string[] {
  const parts: string[] = []
  let start = 0
  for (const c of pts) {
    parts.push(text.slice(start, c))
    start = c + 1
  }
  parts.push(text.slice(start))
  return parts
}

/** S11/S12: split one buffer line into topic candidates. Split at commas and
 *  semicolons outside brackets, and at ". Word" sentence joins (skipping
 *  abbreviations like "e.g."). A piece that opens brackets closed only in a
 *  later piece ("Concept, Modes and Types (Single, Multiple, …)") is rejoined
 *  with the following pieces until the brackets balance. */
function splitLinePieces(line: string): string[] {
  // S11: a comma that sits BEFORE an opening bracket belongs to the same topic
  // as everything inside that bracket — "Inheritance: Concept, Modes and Types
  // (Single, Multiple, Multilevel, Hierarchical)" is ONE topic, so we must not
  // cut at the comma in front of "(Single". Drop such commas from the split
  // set; commas inside the brackets are already protected by depth tracking.
  // (The opening bracket itself sits at p+1 — "Types (Single" — so check for
  // it directly; the old regex required a space first and missed every case.)
  const pts = splitPoints(line, /[,;]/).filter((p) => line[p + 1] !== '(' && line[p + 1] !== '[' && line[p + 1] !== '{')
  const dotPts: number[] = []
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (depth > 0) continue
    if (ch === '.' && /\s/.test(line[i + 1] ?? '') && /[A-Z]/.test(line[i + 2] ?? '')) {
      const before = line.slice(Math.max(0, i - 6), i + 1).toLowerCase()
      if (!/(?:\s|^)(?:e|i|vs|approx|no|dept|engg?|etc)\.\s*$/.test(before)) dotPts.push(i)
    }
  }
  const all = [...pts, ...dotPts].sort((a, b) => a - b)
  const raw = cutAt(line, all)
  // Rejoin pieces whose brackets don't balance. A piece that opens more
  // brackets than it closes ("Modes and Types (Single") is only the FIRST
  // half of its topic — glue it to following pieces until depth returns to
  // zero ("… (Single, Multiple, Multilevel, Hierarchical)"). Pieces that are
  // already balanced stay separate topics.
  const out: string[] = []
  for (const p of raw) {
    const prev = out[out.length - 1]
    if (prev !== undefined && bracketDepth(prev) > 0) {
      const glue = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(p.trimStart()) ? ' ' : ''
      out[out.length - 1] = prev + glue + p
      continue
    }
    out.push(p)
  }
  return out.map(cleanTopic).filter(Boolean)
}

function bracketDepth(s: string): number {
  let d = 0
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') d++
    else if (c === ')' || c === ']' || c === '}') d = Math.max(0, d - 1)
  }
  return d
}

/** Public helper used by tests and the review screen: split a run of topic
 *  text into individual topic names applying S10–S12. */
export function splitTopics(text: string): string[] {
  const out: string[] = []
  for (const piece of splitLinePieces(dehyphenate(text))) out.push(piece)
  return out
}

// ---------------- S14: group headings ----------------

/** S14: a short phrase ending with ":" that labels the topics after it
 *  ("Astronomy:", "Mathematics:"). Long phrases are sentences with a colon —
 *  keep them as topics. */
function isGroupHeading(s: string): boolean {
  const t = s.trim()
  if (!t.endsWith(':')) return false
  const body = t.slice(0, -1).trim()
  if (!body || body.length > 30) return false
  if (wordCount(body) > 3) return false
  return /^[A-Z]/.test(body)
}

/** Pieces of a joined buffer line, keeping a leading group heading separate. */
function piecesWithGroup(line: string): { group?: string; rest: string[] } {
  const m = line.match(/^(\s*[A-Za-z][^,:;]{0,30}:)(\s[\s\S]*)?$/)
  if (m && isGroupHeading(m[1])) {
    const restText = (m[2] ?? '').trim()
    const rest = restText ? splitLinePieces(dehyphenate(restText)) : []
    return { group: cleanTopic(m[1].slice(0, -1)), rest }
  }
  return { rest: splitLinePieces(dehyphenate(line)) }
}

/** S16: remove a stray ".,", normalise missing comma spaces, drop a final full
 *  stop, remove a leading "and". Change no other words. */
function cleanTopic(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim()
  t = fixCommaSpacing(t)
  t = t.replace(/\.\s*,/g, ',').replace(/,\s*\.(?=\s|$)/g, '')
  t = t.replace(/\.\s*\.$/g, '.')
  t = t.replace(/[.,;:\s]+$/, '')
  t = t.replace(/^(and|&)\s+/i, '')
  return t.trim()
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

/** S13: numbered list — strip the leading "N." from each item. */
const NUM_ITEM_RE = /^(?:\d{1,2})[.)]\s+/

// ---------------- Main parse ----------------

/** Where a Course Content section ends. */
const CONTENT_END_RE = /^(text\s*books?.*|reference books.*|weblink.*|evaluation scheme|course objectives|course outcomes|list of experiments|mapping of|articulation|weightage|scheme of examination|semester registration|distribution of marks)/i
/** Where a Springboard table ends. */
const SPRINGBOARD_END_RE = /^(text\s*books|reference books|course objectives|course outcomes|list of experiments|evaluation scheme|mapping of|articulation|weightage|scheme of examination|projects on infosys|springboard courses?[:\s]|infosys springboard courses?[:\s])/i

interface Section {
  kind: 'content' | 'springboard'
  page: number
  start: number // index into kept lines
  end: number // exclusive
}

/** A course code never contains lowercase letters — that kills false hits on
 *  wrapped URLs (".../toc/lex_auth_0135...") and long mixed-case words. */
const CODE_TOKEN_RE = /^[A-Z][A-Z0-9/_-]{4,}\d[A-Z0-9]*$/
const COLON_CODE_RE = /([A-Z][A-Z0-9/_-]{4,}\d[A-Z0-9]*)\s*:\s*(.*)/
/** Words that are never part of a course title — guards the grid-row name
 *  pick-up against random body text that happens to share a line. */
const NOT_A_TITLE_RE = /(springboard|wingspan|outcome|outcome|board of studies|taxonomy|affinity|http|https|course type|semester|lecture|tutorial|practical|marks|credits|scheme)/i

export function parseSyllabusLines(lines: Line[]): SyllabusParseResult {
  const kept = lines.filter((l) => !isFurnitureItems(l.items))
  if (kept.length === 0) return { subjects: [], scanned: true }

  // ---- S3: subject headers. The syllabus pages each start with a title line
  // "CODE: Full Name" (or "CODE:Name" with no space). The programme-structure
  // grid also contains bare codes — those rows are only accepted when the name
  // sits immediately right of the code in the same line; otherwise the code is
  // remembered and unlocked later by its colon header (never dropped, so order
  // follows the document). Deduplicated by code; first occurrence wins. ----
  interface Head {
    idx: number // kept-line index of the subject's FIRST line (title or grid row)
    titleIdx: number // kept-line index of its "CODE: Name" title, -1 until seen
    detailStart: number // first content line after the title, -1 until seen
    gridName: string // name collected from the programme-structure grid rows
    titleName: string // name from the colon title line
    code: string // course code, e.g. "BTECS26103"
  }
  const heads: Head[] = []
  const headByCode = new Map<string, number>() // code -> index into heads
  const mkHead = (idx: number, code = ''): Head => ({ idx, titleIdx: -1, detailStart: -1, gridName: '', titleName: '', code })

  // The programme-structure grid lives on its own page(s), delimited by the
  // "Programme Structure" heading and the semester column header ("SEM-I").
  // Bare codes OUTSIDE that region are never subject anchors — they're stray
  // references in body text and must not create a phantom head that bounds
  // other subjects' section windows. Detect anchors per PAGE: a page counts as
  // a grid page only if it has BOTH the exact "Programme Structure" line (as a
  // standalone fragment — cover/running titles like "Programme Structure &
  // Syllabus" don't qualify) and a "SEM-*" column header.
  const gridPages = new Set<number>()
  for (const l of kept) {
    const soloHeading = l.items.some((it) => /^programme structure$/i.test(it.str.trim()))
    const semCol = l.items.some((it) => /^SEM[- ]?\w+$/.test(it.str.trim()))
    if (soloHeading) gridPages.add(l.page)
    if (semCol && gridPages.has(l.page)) { /* confirmed pair */ } else if (semCol) gridPages.add(-l.page - 1)
  }
  // keep only pages where both markers occurred
  const confirmed = new Set<number>()
  for (const p of gridPages) {
    if (p < 0) continue
    const hasH = kept.some((l) => l.page === p && l.items.some((it) => /^programme structure$/i.test(it.str.trim())))
    const hasS = kept.some((l) => l.page === p && l.items.some((it) => /^SEM[- ]?\w+$/.test(it.str.trim())))
    if (hasH && hasS) confirmed.add(p)
  }
  const inGridRegion = (page: number) => confirmed.has(page)

  // pass 1 — title lines "CODE: Full Name". These anchor each subject and give
  // its official name. Codes seen earlier in the grid keep the grid's position
  // as idx (so ordering follows the document), but sections are located AFTER
  // the title line via detailStart.
  for (let i = 0; i < kept.length; i++) {
    const items = kept[i].items
    for (const it of items) {
      const m = it.str.trim().match(COLON_CODE_RE)
      if (!m || !CODE_TOKEN_RE.test(m[1])) continue
      const code = m[1]
      const name = cleanUnitTitle(m[2]).replace(/[:\u2013-]+$/, '').trim()
      let hi = headByCode.get(code)
      if (hi === undefined) {
        hi = heads.length
        headByCode.set(code, hi)
        heads.push(mkHead(i, code))
      }
      const h = heads[hi]
      if (name) {
        h.titleName = h.titleName || name
        h.titleIdx = i
        h.detailStart = i + 1
      } else if (h.titleIdx === -1) {
        // "CODE:" with the name on a following fragment/line — handled below
        if (h.titleIdx === -1) h.titleIdx = i
        if (h.detailStart === -1) h.detailStart = i + 1
      }
      break
    }
  }

  // pass 2 — bare codes in the programme-structure grid. The course name sits
  // in the "Tentative Course Name" column band (x ≈ 195–340); rows wrap over
  // several baselines, so continuation lines (no code, name-band text) extend
  // the previous grid row's name.
  let lastGridHi = -1
  for (let i = 0; i < kept.length; i++) {
    const items = kept[i].items
    let codeTok = ''
    let codeX = -1
    for (const it of items) {
      const s = it.str.trim()
      if (CODE_TOKEN_RE.test(s) && !COLON_CODE_RE.test(s)) {
        codeTok = s
        codeX = it.x
        break
      }
    }
    if (codeTok) {
      // bare codes only anchor subjects inside the programme-structure grid;
      // elsewhere they are stray references in body text — ignore the line as
      // a head, but keep continuation handling off for it too.
      if (!inGridRegion(kept[i].page)) { lastGridHi = -1; continue }
      let hi = headByCode.get(codeTok)
      if (hi === undefined) {
        hi = heads.length
        headByCode.set(codeTok, hi)
        heads.push(mkHead(i, codeTok))
      }
      const h = heads[hi]
      h.idx = Math.min(h.idx, i)
      // name fragments on this line inside the course-name band, right of code
      const nm = items
        .filter((it) => it.x >= 195 && it.x <= 340 && /[A-Za-z]/.test(it.str) && colOfFragment(it.x, it.end) !== colOfFragment(codeX, codeX + 1))
        .map((it) => it.str.trim())
        .join(' ')
      if (nm && !NOT_A_TITLE_RE.test(nm)) h.gridName = joinFragments([h.gridName, nm])
      lastGridHi = hi
      continue
    }
    // continuation line of a wrapped grid row: short name-band text, no other columns
    if (lastGridHi >= 0) {
      const bandItems = items.filter((it) => it.x >= 195 && it.x <= 340 && /[A-Za-z]/.test(it.str))
      const otherItems = items.filter((it) => !(it.x >= 195 && it.x <= 340) && /[A-Za-z]{2,}/.test(it.str))
      if (bandItems.length > 0 && otherItems.length === 0) {
        const nm = bandItems.map((it) => it.str.trim()).join(' ')
        if (nm && !NOT_A_TITLE_RE.test(nm)) heads[lastGridHi].gridName = joinFragments([heads[lastGridHi].gridName, nm])
      }
    }
  }

  // resolve names: title wins, grid fills gaps (e.g. "BTECES26105:" printed
  // without its name on the title line).
  for (const h of heads) {
    if (!h.titleName && h.gridName) h.titleName = h.gridName
    if (!h.gridName && h.titleName) h.gridName = h.titleName
  }
  // subjects whose name never materialised anywhere are dropped
  // A code needs BOTH a programme-structure grid row AND its own "CODE: Name"
  // title page to be a real subject. Grid-only codes (e.g. BTECES26107
  // "Induction Training") have no detail pages; titled-but-not-in-grid tokens
  // are stray references in body text. Either alone is noise that would bound
  // windows and steal neighbouring subjects' sections.
  const realHeads = heads.filter((h) => h.titleIdx !== -1 && h.gridName)
  realHeads.sort((a, b) => a.idx - b.idx)
  heads.length = 0
  heads.push(...realHeads)

  // ---- locate Course Content / Springboard sections (never across pages) ----
  const sections: Section[] = []
  for (let i = 0; i < kept.length; i++) {
    const full = cellText(kept[i], 0, 6)
    if (/^course content\b/i.test(full) || /^title:\s*course content$/i.test(full)) {
      sections.push({ kind: 'content', page: kept[i].page, start: i + 1, end: findEnd(kept, i + 1, kept[i].page, CONTENT_END_RE) })
      continue
    }
    if (/^(infosys springboard courses?[!:\s]*|springboard courses?[!:\s]*)/i.test(full)) {
      sections.push({ kind: 'springboard', page: kept[i].page, start: i + 1, end: findEnd(kept, i + 1, kept[i].page, SPRINGBOARD_END_RE) })
      continue
    }
  }

  const subjects: ParsedSyllabusSubject[] = []
  // Section windows follow the TITLED heads (the "CODE: Name" detail-page
  // titles) only. A bare code seen in the programme-structure grid that never
  // gets a title line ("BTECES26107 Induction Training") must not bound any
  // window — otherwise it truncates the real subject before it and becomes a
  // catch-all swallowing every later section. Grid-only codes are reported as
  // subjects with empty units/links unless they own content pages.
  const titledHeads = heads.filter((hh) => hh.titleIdx !== -1).sort((a, b) => a.idx - b.idx)
  for (let h = 0; h < titledHeads.length; h++) {
    // Window starts at the TITLE line, not the grid row: a stray bare code or
    // section header printed on the detail page BEFORE the title would land in
    // [idx, titleIdx) and, being first, steal that subject's sections.
    const from = Math.max(titledHeads[h].titleIdx, titledHeads[h].detailStart - 1)
    const to = h + 1 < titledHeads.length ? titledHeads[h + 1].idx : kept.length
    const subj: ParsedSyllabusSubject = {
      code: titledHeads[h].code,
      fullName: titledHeads[h].titleName,
      shortName: guessShortName(titledHeads[h].titleName),
      units: [],
      links: [],
    }
    for (const sec of sections) {
      if (sec.start >= from && sec.end <= to) {
        const slice = kept.slice(sec.start, sec.end)
        if (sec.kind === 'content') subj.units.push(...parseCourseContent(slice))
        else subj.links.push(...parseSpringboardTable(slice))
      }
    }
    subjects.push(subj)
  }
  // grid-only codes without a title line: report them only when they actually
  // own sections (rare); otherwise drop so callers see exactly the subjects
  // this document details.
  for (const hh of heads) {
    if (hh.titleIdx !== -1) continue
    const nextTitled = titledHeads.find((t) => t.idx > hh.idx)
    const to = nextTitled ? nextTitled.idx : kept.length
    const subj: ParsedSyllabusSubject = { code: hh.code, fullName: hh.titleName || hh.gridName, shortName: guessShortName(hh.titleName || hh.gridName), units: [], links: [] }
    for (const sec of sections) {
      if (sec.start >= hh.idx && sec.end <= to) {
        const slice = kept.slice(sec.start, sec.end)
        if (sec.kind === 'content') subj.units.push(...parseCourseContent(slice))
        else subj.links.push(...parseSpringboardTable(slice))
      }
    }
    if (subj.units.length > 0 || subj.links.length > 0) subjects.push(subj)
  }
  subjects.sort((a, b) => heads.findIndex((hh) => hh.code === a.code) - heads.findIndex((hh) => hh.code === b.code))

  return { subjects, scanned: false }
}

function findEnd(kept: Line[], from: number, page: number, endRe: RegExp): number {
  for (let j = from; j < kept.length; j++) {
    if (kept[j].page !== page) return j // sections never span pages
    const full = cellText(kept[j], 0, 6)
    if (endRe.test(full)) return j
    if (SUBJECT_CODE_RE.test(full)) return j
    if (BARE_CODE_RE.test(full)) return j
  }
  return kept.length
}

/** Short name: initials of the significant words, unless the title itself is
 *  an acronym-ish phrase. E.g. "Statistics and Differential Calculus" → SDC. */
export function guessShortName(fullName: string): string {
  const words = fullName.split(/\s+/).filter((w) => w.length > 0 && !/^(and|of|the|in|&)$/i.test(w))
  if (words.length >= 2 && words.length <= 6) {
    const ini = words.map((w) => w[0].toUpperCase()).join('')
    if (/^[A-Z]{2,6}$/.test(ini)) return ini
  }
  return fullName.split(/\s+/)[0].slice(0, 8)
}

// ---------------- Course Content (S4–S16) ----------------

function parseCourseContent(lines: Line[]): ParsedUnit[] {
  const units: ParsedUnit[] = []
  let cur: ParsedUnit | null = null
  let pendingTitleCont = false
  let sawNumberedList = false

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const col0 = cellText(l, 0, 0)
    const full = cellText(l, 0, 6)

    // S5/S6: unit header, possibly split across two lines
    let hm = col0.match(UNIT_HEAD_RE) || full.match(UNIT_HEAD_RE)
    if (!hm && /^unit$/i.test(col0)) {
      const nxt = cellText(lines[i + 1] ?? l, 0, 6)
      const m2 = nxt.match(UNIT_SPLIT_RE)
      if (m2) {
        hm = [nxt, m2[1], m2[2]]
        i++ // consumed the next line too
      }
    }
    if (hm) {
      const tail0 = hm[2] ?? ''
      const { hours, rest, ambiguous } = extractHours(tail0)
      let title = cleanUnitTitle(rest)
      // S8: title wraps onto the next, more-indented line
      const next = lines[i + 1]
      if (next) {
        const n0 = next.items[0]?.x ?? 0
        const nFull = cellText(next, 0, 6)
        if (!UNIT_HEAD_RE.test(nFull) && !/^\d+[.)]/.test(nFull) && n0 > 40 && n0 < 144 && /[A-Za-z]/.test(nFull) && !/^hours?$/i.test(nFull)) {
          title = cleanUnitTitle(title + ' ' + nFull)
          i++
        }
      }
      cur = { number: Number.parseInt(hm[1], 10), title, hours: hours ?? 0, topics: [], needsReview: ambiguous || hours == null }
      units.push(cur)
      pendingTitleCont = false
      sawNumberedList = false
      continue
    }
    if (!cur) continue

    // skip pure column-leftover lines (S9)
    if (/^(hours?|co|bt|btl|l|t|po|pos)\b/i.test(full) && wordCount(full) <= 2) continue

    const numM = full.match(NUM_ITEM_RE)
    if (numM) sawNumberedList = true // S13: this unit is a numbered list

    // Collect the unit body up to the next unit header (handled by loop)
    const body = full
    if (!body) continue
    appendBody(cur, body, sawNumberedList)
    void pendingTitleCont
  }

  // Post-pass: S12 second sentence = new topic; S14 groups; flags
  for (const u of units) finalizeUnit(u)
  return units
}

/** Feed one body line into the current unit. Lines are appended to a buffer
 *  on the unit and split later, so cross-line separators behave (S10/S11). */
function appendBody(unit: ParsedUnit, body: string, numbered: boolean) {
  const buf = (unit as unknown as { _buf?: string[] })._buf ?? ((unit as unknown as { _buf: string[] })._buf = [])
  buf.push(numbered ? body.replace(NUM_ITEM_RE, '') : body)
}

function finalizeUnit(u: ParsedUnit) {
  const buf = (u as unknown as { _buf?: string[] })._buf ?? []
  delete (u as unknown as { _buf?: string[] })._buf
  const joined = dehyphenate(buf.join(' ')).replace(/\s+/g, ' ').trim()
  if (!joined) return

  // S14: a short line ending with ":" is a group heading applying to the
  // topics that follow it (until the next such heading).
  let group: string | undefined
  const pieces = splitTopics(joined)
  const topics: ParsedTopic[] = []
  for (let pi = 0; pi < pieces.length; pi++) {
    let piece = pieces[pi]
    // group heading piece: very short and ends with a colon before splitting ate it
    const gCandidate = buf.find((b) => /^[A-Za-z][^,:;]{0,30}:$/.test(b.trim()))
    void gCandidate
    if (/^[A-Z][^.:;]{1,30}:/.test(piece)) {
      const g = piece.slice(0, -1).trim()
      // treat as group only when the remainder of this piece is empty
      if (piece.endsWith(':')) {
        group = g
        continue
      }
    }
    // S12: ". Word" already split; also split when a sentence ends and the
    // next begins with a capital AND the piece contains a second sentence
    // longer than a stub (only applied where S11's strict check missed it).
    piece = cleanTopic(piece)
    if (!piece) continue
    topics.push({ name: piece, group, needsSplit: wordCount(piece) > 12 }) // S17
  }
  u.topics = topics
}

// ---------------- Springboard tables (L1–L6) ----------------

/** Merge URL fragments that wrap across baselines inside one column.
 *  Returns cleaned URLs plus the lines they occupied. */
function rebuildLinks(lines: Line[], c0: number, c1: number): { urls: Map<number, string[]>; used: Set<number> } {
  const used = new Set<number>()
  const urls = new Map<number, string[]>()
  for (let i = 0; i < lines.length; i++) {
    const frag = cellText(lines[i], c0, c1)
    if (!frag.startsWith('http')) continue
    let acc = frag
    let j = i + 1
    while (!/(overview|_shared)$/.test(acc) && /(\/|on|com|app|toc|auth_|_shared|[0-9])$/.test(acc) && j < lines.length) {
      const nf = cellText(lines[j], c0, c1)
      if (!nf || !/^[a-z0-9_\/.-]/i.test(nf)) break
      const cont = lines[j].items.find((it) => colOfFragment(it.x, it.end) >= c0 && colOfFragment(it.x, it.end) <= c1)?.str
      if (!cont) break
      acc += cont.trim()
      used.add(j)
      j++
      if (j - i > 8) break
    }
    const arr = urls.get(i) ?? []
    arr.push(acc)
    urls.set(i, arr)
    used.add(i)
  }
  return { urls, used }
}

function normalizeSpringboardUrl(u: string): { url: string; repaired: boolean; needsChecking: boolean } {
  let url = u.trim()
  let repaired = false
  // L2: rebuild the fixed shape https://infyspringboard.onwingspan.com/web/en/app/toc/<id>/overview
  const m = url.match(/^https?:\/\/infyspringboard\.?on?w?i?n?g?s?p?a?n?\.?c?o?m?\/?(.*)$/i)
  if (m) {
    const tail = m[1].replace(/^\/+/, '')
    if (!tail.startsWith('web/en/app/toc/')) {
      const lex = tail.match(/(lex_[A-Za-z0-9_]+|lex_auth_[0-9_a-z]+)/i)?.[1]
      if (lex) {
        url = `https://infyspringboard.onwingspan.com/web/en/app/toc/${lex}`
        repaired = true
      }
    }
  }
  if (/^https?:\/\//i.test(url)) {
    if (!/(overview|_shared\/overview)$/.test(url)) {
      if (/\/(toc|app)\/(lex|18)/.test(url) || /lex_/.test(url)) {
        url = `${url.replace(/\/+$/, '')}/overview`
        repaired = true
      }
    }
  }
  const bad = !/^https:\/\/infyspringboard\.onwingspan\.com\/web\/en\/app\/toc\/[^/]+\/(overview|_shared\/overview)$/.test(url) && /^https?:\/\/infyspringboard/i.test(url)
  return { url, repaired, needsChecking: bad && !/linkedin|coursera|nptel|youtube|google/i.test(url) }
}

function parseSpringboardTable(lines: Line[]): ParsedCourseLink[] {
  const out: ParsedCourseLink[] = []
  // Header row tells which layout: find columns by their header x positions.
  let hdr = lines.find((l) => /Course Name/i.test(cellText(l, 0, 6)) || /Springboard Course/i.test(cellText(l, 0, 6)))
  let nameC0 = 0, nameC1 = 1, urlC0 = 3, urlC1 = 3, coC0 = 5, coC1 = 6, hasUnitCol = true
  if (hdr) {
    const htext = cellText(hdr, 0, 6)
    if (/Course Name/.test(htext)) {
      // FE layout: Course Name | Contents | Links | CO   (no Unit column)
      hasUnitCol = false
      nameC0 = 0; nameC1 = 0; urlC0 = 3; urlC1 = 3; coC0 = 5; coC1 = 6
    }
  } else {
    hdr = lines[0]
  }
  void htextOf(hdr)

  const { urls, used } = rebuildLinks(lines, urlC0, urlC1)

  // Rows: a row starts at a line that has a name fragment in the name column
  // or a URL. Group consecutive non-used lines between row starts.
  let rowStart = -1
  const rows: { start: number; end: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) {
      if (rowStart === -1) rowStart = i
      continue
    }
    const nm = cellText(lines[i], nameC0, nameC1)
    if (nm && !/^unit$/i.test(nm) && !/^(topics|contents|links|springboard course|co)\b/i.test(nm)) {
      if (rowStart === -1) rowStart = i
      continue
    }
    if (rowStart !== -1) {
      rows.push({ start: rowStart, end: i - 1 })
      rowStart = -1
    }
  }
  if (rowStart !== -1) rows.push({ start: rowStart, end: lines.length - 1 })

  for (const r of rows) {
    const rowLines = lines.slice(r.start, r.end + 1)
    const nameParts: string[] = []
    const unitParts: string[] = []
    let co = ''
    for (const l of rowLines) {
      if (hasUnitCol) {
        const un = cellText(l, 0, 1)
        if (un && !/^unit$/i.test(un)) unitParts.push(un)
        const tp = cellText(l, 1, 1)
        void tp
      } else {
        const nm = cellText(l, 0, 0)
        if (nm) nameParts.push(nm)
      }
      const coTxt = cellText(l, coC0, coC1)
      if (coTxt && !co) co = coTxt
    }
    const collectedUrls: string[] = []
    for (let i = r.start; i <= r.end; i++) {
      const arr = urls.get(i)
      if (arr) collectedUrls.push(...arr)
    }
    if (hasUnitCol) {
      // SDC/CP/WAD/VACO/IKS layout: Unit | Topics | Springboard Course(name+url) | CO
      // The course NAME lives in the same column as the URL (col index 3 for
      // WAD, 3 for CP/SDC variants) — collect non-http text in url column area.
      const nameTxt: string[] = []
      for (const l of rowLines) {
        const seg = cellText(l, 3, 3)
        if (seg && !seg.startsWith('http')) nameTxt.push(seg)
      }
      const unitLabel = joinFragments(unitParts)
      const name = joinFragments(nameTxt)
      if (!name && collectedUrls.length === 0) continue
      out.push(makeLink(name, collectedUrls, co, unitLabel))
    } else {
      const name = joinFragments(nameParts)
      if (!name && collectedUrls.length === 0) continue
      out.push(makeLink(name, collectedUrls, co, undefined))
    }
  }
  return out.filter((c) => c.name || c.url)
}

function makeLink(name: string, urls: string[], co: string, unitLabel?: string): ParsedCourseLink {
  const base = {
    name: cleanTopic(name),
    platform: 'Infosys Springboard',
    coNumber: co || undefined,
    unitLabel: unitLabel || undefined,
    unitNumber: unitLabel?.match(/\d+/)?.[0] ? Number.parseInt(unitLabel.match(/\d+/)![0], 10) : undefined,
  }
  if (urls.length === 0) return { ...base, url: '', needsChecking: false, otherSite: false, noLink: true } // L6
  const url = urls[0]
  if (/^https?:\/\//i.test(url) && !/infyspringboard/i.test(url)) {
    return { ...base, url, needsChecking: false, otherSite: true, noLink: false } // L5
  }
  const { url: fixed, needsChecking } = normalizeSpringboardUrl(url) // L2/L4
  return { ...base, url: fixed, needsChecking, otherSite: false, noLink: false }
}

function htextOf(l: Line | undefined): string {
  return l ? cellText(l, 0, 6) : ''
}

// ---------------- S18: match to existing subjects ----------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function matchSubjects(
  parsed: ParsedSyllabusSubject[],
  existing: { id: string; shortName: string; fullName: string }[],
): void {
  for (const p of parsed) {
    const hit = existing.find(
      (e) =>
        norm(e.fullName) === norm(p.fullName) ||
        norm(e.shortName) === norm(p.shortName) ||
        norm(e.fullName).includes(norm(p.shortName)) ||
        norm(p.fullName).includes(norm(e.shortName)),
    )
    if (hit) p.matchedSubjectId = hit.id
  }
}

/** Convert parsed links into CourseLink drafts for importCourseLinks (H11
 *  keeps statuses of links that are still there). */
export function toCourseLinkDrafts(parsed: ParsedSyllabusSubject[]): Omit<CourseLink, 'id'>[] {
  const drafts: Omit<CourseLink, 'id'>[] = []
  for (const p of parsed) {
    for (const c of p.links) {
      drafts.push({
        subjectId: p.matchedSubjectId ?? '',
        unitTitle: c.unitLabel,
        unitNumber: c.unitNumber,
        name: c.name,
        platform: c.platform,
        url: c.url,
        coNumber: c.coNumber,
        status: 'not started',
        needsChecking: c.needsChecking,
      })
    }
  }
  return drafts
}
