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
}

interface LineItem {
  x: number
  end: number
  str: string
}
interface Line {
  y: number
  items: LineItem[]
}

/** Group pdfjs text items into visual lines (same baseline y), sorted top→down,
 *  items left→right. Rows that are within 2px of each other merge — table cell
 *  text often sits a pixel or two off the header baseline. */
export function groupItemsIntoLines(items: TextItemLike[]): Line[] {
  const real = items.filter((it) => it.str && it.str.trim())
  const lines: Line[] = []
  for (const it of real) {
    const y = Math.round(it.transform[5])
    const w = (it.width ?? 0) || Math.max(1, it.str.length * 4)
    const entry = { x: Math.round(it.transform[4]), end: Math.round(it.transform[4]) + Math.round(w), str: it.str }
    let ln = lines.find((l) => Math.abs(l.y - y) <= 2)
    if (!ln) {
      ln = { y, items: [] }
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
  for (const pg of pages) allLines.push(...groupItemsIntoLines(pg))
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
    .map((t, i) => ({ y: 1000 - i, items: [{ x: 0, end: t.length * 6, str: t }] }))
}

// ---------------- S2: repeated page furniture ----------------

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

// ---------------- Column model ----------------

/** Fixed x boundaries between table columns (measured on the Sem-1 PDF).
 *  A text item belongs to the last column whose start is ≤ its x. */
const COL_BOUNDS = [0, 34, 144, 328, 507, 533, 545, Infinity]
const colOf = (x: number): number => {
  for (let i = COL_BOUNDS.length - 1; i >= 0; i--) if (x >= COL_BOUNDS[i]) return i
  return 0
}

/** Items of a line that lie inside columns [c0, c1], joined in reading order.
 *  Fragments closer than 14px are considered one word (pdfjs splits bold/
 *  italic runs mid-word, e.g. "Bay's Theorem"). */
function cellText(line: Line, c0: number, c1: number): string {
  const parts: string[] = []
  for (const it of line.items) {
    const c = colOf(it.x)
    if (c < c0 || c > c1) continue
    parts.push(it.str)
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

const SUBJECT_CODE_RE = /^([A-Z]{2,}[A-Z0-9]*\d{4,}[A-Z0-9]*):\s*(.+)$/

// ---------------- S5/S6/S7/S8: unit headers ----------------

const UNIT_HEAD_RE = /^unit\s*(?:no)?\.?\s*(\d+)\b(.*)$/i
/** S6: "Unit" alone on one line, "No.01" on the next. */
const UNIT_SPLIT_RE = /^no\.?\s*(\d+)\b(.*)$/i

/** S7: hours = the number next to the word "Hours"; if the word is missing,
 *  the first lone number ≥ 2 in the tail. */
function extractHours(tail: string): { hours: number | null; rest: string; ambiguous: boolean } {
  let m = tail.match(/(\d+(?:\.\d+)?)\s*(?:-\s*\d+\s*)?hours?/i)
  if (m) return { hours: Number.parseInt(m[1], 10), rest: tail.replace(m[0], ''), ambiguous: false }
  m = tail.match(/hours?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i)
  if (m) return { hours: Number.parseFloat(m[1]), rest: tail.replace(m[0], ''), ambiguous: false }
  m = tail.match(/(?:^|\s)(\d{1,2})(?=\s|$)/)
  if (m) return { hours: Number.parseInt(m[1], 10), rest: tail.replace(m[0], ' '), ambiguous: true }
  return { hours: null, rest: tail, ambiguous: false }
}

/** S9: drop table-column leftovers beside the unit text. */
function cleanUnitTitle(s: string): string {
  return s
    .replace(/\b(CO|BT|BTL|POs?|PSOs?)\b/g, ' ')
    .replace(/\b\d{1,2}\b(?=(\s+\d{1,2}\b)*\s*$)/g, ' ') // trailing bare numbers
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,:;-]+$/, '')
    .trim()
}

// ---------------- S10–S16: topic splitting ----------------

/** S10: join a word broken across lines with a hyphen. */
function dehyphenate(text: string): string {
  return text.replace(/(\w)-\s+(\w)/g, (_all, a, b) => `${a}${String(b).toLowerCase() === String(b) ? b : b.toLowerCase()}`)
}

/** S11: split at commas/semicolons outside brackets, and at ". Word". */
export function splitTopics(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || ch === ';')) {
      parts.push(cur)
      cur = ''
      continue
    }
    if (depth === 0 && ch === '.' && /\s/.test(text[i + 1] ?? '') && /[A-Z]/.test(text[i + 2] ?? '')) {
      parts.push(cur)
      cur = ''
      i += 1
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map(cleanTopic).filter(Boolean)
}

/** S16: remove a stray ".," and a final full stop, remove a leading "and".
 *  Change no other words. */
function cleanTopic(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim()
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

interface Block {
  kind: 'subject' | 'springboard' | 'content' | 'other'
  head?: { code: string; name: string }
  lines: Line[]
}

/** S4: where a Course Content section ends. */
const CONTENT_END_RE = /^(text\s*books?.*|reference books.*|weblink.*|evaluation scheme|course objectives|course outcomes|list of experiments|mapping of|articulation|weightage|scheme of examination|semester registration|distribution of marks|ble per course)/i
/** Where a Springboard table ends. */
const SPRINGBOARD_END_RE = /^(text\s*books|reference books|course objectives|course outcomes|list of experiments|evaluation scheme|mapping of|articulation|weightage|scheme of examination|co )/i

interface Section {
  kind: 'content' | 'springboard'
  start: number
  end: number // exclusive
}

export function parseSyllabusLines(lines: Line[]): SyllabusParseResult {
  const kept = lines.filter((l) => !isFurnitureLine(cellText(l, 0, 6)))
  if (kept.length === 0) return { subjects: [], scanned: true }

  // ---- locate subject headers and sections across the whole document ----
  const heads: { idx: number; code: string; name: string }[] = []
  const sections: Section[] = []
  for (let i = 0; i < kept.length; i++) {
    const full = cellText(kept[i], 0, 6)
    const m = full.match(SUBJECT_CODE_RE)
    if (m) {
      heads.push({ idx: i, code: m[1], name: cleanUnitTitle(m[2]) })
      continue
    }
    if (/^(course content)/i.test(full)) {
      sections.push({ kind: 'content', start: i + 1, end: findEnd(kept, i + 1, CONTENT_END_RE) })
      continue
    }
    if (/^(infosys springboard courses?\b|springboard courses?\b)/i.test(full)) {
      sections.push({ kind: 'springboard', start: i, end: findEnd(kept, i + 1, SPRINGBOARD_END_RE) })
      continue
    }
  }

  const subjects: ParsedSyllabusSubject[] = []
  for (let h = 0; h < heads.length; h++) {
    const from = heads[h].idx
    const to = h + 1 < heads.length ? heads[h + 1].idx : kept.length
    const subj: ParsedSyllabusSubject = {
      code: heads[h].code,
      fullName: heads[h].name,
      shortName: guessShortName(heads[h].name),
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

  return { subjects, scanned: false }
}

function findEnd(kept: Line[], from: number, endRe: RegExp): number {
  for (let j = from; j < kept.length; j++) {
    const full = cellText(kept[j], 0, 6)
    if (endRe.test(full)) return j
    if (SUBJECT_CODE_RE.test(full)) return j
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
      const cont = lines[j].items.find((it) => colOf(it.x) >= c0 && colOf(it.x) <= c1)?.str
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
