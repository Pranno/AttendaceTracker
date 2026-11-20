// Deadline paste extraction (D-series).
// Input: raw text of a college WhatsApp/class message.
// Output: one or more candidate deadlines with due date, subject, title.
// Everything is tentative until the user confirms in the preview UI.

import type { DateStr } from '../data/model'
import { HOLIDAY_RE } from './holidays'
import type { DeadlineCategory } from './deadlineCategory'

/** Words that make a line a real task even if it also mentions a holiday. */
const TASK_RE = /\b(submit|submission|assignment|exam|test|quiz|viva|registration|register|form|fee|payment|apply|upload|report|project|presentation)\b/i

export interface ExtractedDeadline {
  title: string
  /** yyyy-mm-dd */
  dueDate: DateStr
  /** matched subject short-form or name, if any */
  subjectHint?: string
  /** true when only a month/day was given and we rolled to next year */
  tentative: boolean
  /** the line the match came from (for the preview UI) */
  sourceLine: string
  /** H4: http(s) links found on the same line (e.g. course/certificate URLs). */
  urls?: string[]
  /** What kind of deadline (decides what email deadlines are added automatically). */
  category?: DeadlineCategory
}

export interface SubjectRef {
  id?: string
  shortName: string
  fullName?: string
  nicknames?: string[]
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(y: number, m: number, d: number): DateStr {
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Parse "5/1", "05.01", "5-1-2026", "5 Jan", "Jan 5", "5th January" etc.
 * Returns {month, day, year?} or null. Handles dd/mm (day first) per Indian format.
 * Rule M5/C12: 09-11 with a hyphen is accepted ONLY with a year (9-11-2026),
 * so that "Grades 1-12" is never read as 1 December. */
function parseDayMonth(s: string): { m: number; d: number; y?: number } | null {
  // Slashed or dotted: 5/1, 05.01, 5/11/2026.
  // A dotted pair followed by am/pm/hrs is a clock time ("10.30 am"), not a
  // date — it used to be read (via the mm/dd swap) as 30 Oct and win over the
  // real "5 Jan" later on the line. Keep scanning past such matches, and fall
  // through to the month-name formats when no numeric date is valid.
  for (const mm of s.matchAll(/\b(\d{1,2})\s*([/.])\s*(\d{1,2})(?:[/.](\d{2,4}))?\b/g)) {
    const after = s.slice((mm.index ?? 0) + mm[0].length)
    if (/^\s*(?:am|pm|a\.m|p\.m|hrs?|hours|o'?clock)\b/i.test(after)) continue
    if (mm[2] === '.' && !mm[4] && /^\s*[-–]\s*\d{1,2}[.:]\d{2}/.test(after)) continue // "10.30 - 11.30"
    const d = Number(mm[1])
    const m = Number(mm[3])
    const rawY = mm[4] ? Number(mm[4]) : undefined
    const y = rawY ? (rawY < 100 ? 2000 + rawY : rawY) : undefined
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { m, d, y }
    // mm/dd fallback — slash only; "10.30" style dotted pairs are times
    if (mm[2] === '/' && m >= 1 && m <= 31 && d >= 1 && d <= 12) return { m: d, d: m, y }
  }
  let mm: RegExpMatchArray | null

  // Hyphenated ONLY with a year (M5/C12): 9-11-2026 or 09-11-26
  let mmHyphen = s.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,4})\b/)
  if (mmHyphen) {
    const d = Number(mmHyphen[1])
    const m = Number(mmHyphen[2])
    const rawY = Number(mmHyphen[3])
    const y = rawY < 100 ? 2000 + rawY : rawY
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { m, d, y }
    if (m >= 1 && m <= 31 && d >= 1 && d <= 12) return { m: d, d: m, y }
    return null
  }

  // "5 Jan" / "5th Jan" / "Jan 5"
  mm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s+(\d{4}))?\b/i)
  if (mm) {
    const mi = MONTHS.indexOf(mm[2].toLowerCase().slice(0, 3))
    const d = Number(mm[1])
    const y = mm[3] ? Number(mm[3]) : undefined
    if (mi >= 0 && d >= 1 && d <= 31) return { m: mi + 1, d, y }
  }
  mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/i)
  if (mm) {
    const mi = MONTHS.indexOf(mm[1].toLowerCase().slice(0, 3))
    const d = Number(mm[2])
    const y = mm[3] ? Number(mm[3]) : undefined
    if (mi >= 0 && d >= 1 && d <= 31) return { m: mi + 1, d, y }
  }
  return null
}

// A line is a deadline candidate when it mentions any kind of task with a
// date: submissions, exams/tests, registrations, forms, fees, applications…
// (Registration, forms, fees, enrolment and the like used to be missing, so
// "Hackathon registration closes on 25/11" was silently ignored.)
const KEYWORD = new RegExp(
  '(' +
    [
      'submission', 'submit', 'deadline', 'due', 'last date', 'final date', 'closes?', 'ends?', 'before', 'by',
      'hand ?in', 'to be submitted', 'to be completed', 'to be checked', 'completed?',
      'certificates?', 'tests?', 'exams?', 'examination', 'mid[- ]?sem', 'end[- ]?sem', 'quiz', 'viva', 'oral',
      'practical', 'journal', 'lab file', 'presentation', 'seminar', 'project', 'upload', 'report', 'assignments?',
      'registrations?', 'register', 'enrol(?:l)?(?:ment)?', 'forms?', 'apply', 'application', 'fill',
      'fees?', 'payment', 'pay', 'scholarship', 'internship', 'hall ticket', 'admit card', 'download',
      'workshop', 'hackathon', 'competition', 'event', 'meeting', 'orientation',
    ].join('|') +
    ')',
  'i',
)

/** Filler words that say "this is due" but are not part of the task's name. */
const FILLER = /\b(last date(?: of| for| to)?|final date|deadline(?: for| of| is)?|due(?: on| by| date)?|to be (?:submitted|completed|checked)|closes|ends)\b/gi

/** Core sentence that becomes the deadline title: strip dates, filler words & keywords (M7). */
function cleanTitle(line: string, dueIdx: number): string {
  let t = line
  // remove the matched date span conservatively
  t = t.replace(/\b\d{1,2}\s*[/.]\s*\d{1,2}(?:[/.]\d{2,4})?\b/g, '')
  t = t.replace(/\b\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{2,4}\b/g, '')
  t = t.replace(/\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s+\d{4})?/gi, '')
  t = t.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(st|nd|rd|th)?(?:\s+\d{4})?/gi, '')
  // keep the task type ("registration", "exam", "form"); drop only filler
  t = t.replace(FILLER, '')
  // strip filler words at boundaries per M7 ("at", "on", "before", "by")
  t = t.replace(/\b(on|at|before|by)\b\s*$/i, '')
  t = t.replace(/^\s*\b(on|at|before|by)\b/i, '')
  t = t.replace(/[–—-]\s*$/, '').replace(/^\s*[–—:-]+/, '')
  t = t.replace(/[*_~]+/g, '') // strip markdown asterisks and decoration
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/[,;:.!–—-]+\s*$/, '').trim()
  // dangling linking words left after removing the date ("DSA assignment is")
  for (let i = 0; i < 3; i++) t = t.replace(/\s*\b(is|are|was|will be|on|at|before|by|of|for|from|the|from)\s*$/i, '').trim()
  t = t.replace(/[,;:.!–—-]+\s*$/, '').trim()
  void dueIdx
  return t
}

/** Extract candidate deadlines from a pasted message. Supports dynamic subjects (M6). */
export function extractDeadlines(
  text: string,
  today: DateStr,
  userSubjects?: SubjectRef[],
): ExtractedDeadline[] {
  const out: ExtractedDeadline[] = []
  const seen = new Set<string>()
  const ty = Number(today.slice(0, 4))

  // Split into segments: lines
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const dm = parseDayMonth(line)
    if (!dm) continue
    const hasKeyword = KEYWORD.test(line)
    if (!hasKeyword) continue
    // Holiday notices ("college will remain closed on 25/11") are holidays,
    // not deadlines — unless the same line also names a real task.
    if (HOLIDAY_RE.test(line) && !TASK_RE.test(line)) continue

    // Determine year: if explicit, use it. Otherwise, roll if date has passed (D4).
    let y = dm.y ?? ty
    let cand = new Date(y, dm.m - 1, dm.d)
    const now = new Date(today + 'T00:00:00')
    if (!dm.y) {
      if (cand.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 183) {
        y += 1
        cand = new Date(y, dm.m - 1, dm.d)
      }
    }
    // Invalid calendar dates ("31/2") used to roll over silently into the next month.
    if (cand.getMonth() !== dm.m - 1 || cand.getDate() !== dm.d) continue
    // Tentative only when WE picked next year — an explicitly written year is certain.
    const rolled = !dm.y && y !== ty
    const dueDate = toDateStr(cand.getFullYear(), cand.getMonth() + 1, cand.getDate())

    let title = cleanTitle(line, i)
    // If title too short, try merging with previous line
    if (title.length < 3 && i > 0) {
      const prev = lines[i - 1]
      if (!parseDayMonth(prev)) title = cleanTitle(prev + ' ' + line, i)
    }
    if (!title || title.length < 2) continue

    const key = title.toLowerCase() + '|' + dueDate
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      title,
      dueDate,
      subjectHint: matchSubject(line, userSubjects),
      tentative: rolled,
      sourceLine: line,
    })
  }
  return out
}

const SUBJECT_HINTS: Array<[RegExp, string]> = [
  [/\b(DSA|DS)\b/i, 'DSA'],
  [/\b(DBMS|DBM)\b/i, 'DBMS'],
  [/\b(CN|NET)\b/i, 'CN'],
  [/\b(OS|OPS)\b/i, 'OS'],
  [/\b(CO|CD)\b/i, 'CO'],
  [/\b(MATHS?|MAT|CALCULUS)\b/i, 'Maths'],
  [/\b(SE|SWE|SOFTWARE)\b/i, 'SE'],
  [/\b(AI)\b/i, 'AI'],
  [/\b(ML)\b/i, 'ML'],
  [/\b(TP|LAB)\b/i, 'Lab'],
]

/**
 * Match a line to a subject (M6).
 * Checks user subjects first (shortName, fullName, and nicknames — longest match wins),
 * then falls back to general pattern hints.
 */
export function matchSubject(line: string, userSubjects?: SubjectRef[]): string | undefined {
  if (userSubjects && userSubjects.length > 0) {
    let bestMatch: { name: string; len: number } | null = null

    for (const sub of userSubjects) {
      const candidates = [
        sub.shortName,
        sub.fullName,
        ...(sub.nicknames ?? []),
      ].filter((x): x is string => !!x && x.trim().length > 0)

      for (const cand of candidates) {
        const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`, 'i')
        if (re.test(line)) {
          if (!bestMatch || cand.length > bestMatch.len) {
            bestMatch = { name: sub.shortName, len: cand.length }
          }
        }
      }
    }
    if (bestMatch) return bestMatch.name
  }

  for (const [re, name] of SUBJECT_HINTS) {
    if (re.test(line)) return name
  }
  return undefined
}
