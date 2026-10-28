// Deadline paste extraction (D-series).
// Input: raw text of a college WhatsApp/class message.
// Output: one or more candidate deadlines with due date, subject, title.
// Everything is tentative until the user confirms in the preview UI.

import type { DateStr } from '../data/model'

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

/** Parse "5/1", "5-1", "5 Jan", "Jan 5", "5th January" etc.
 * Returns {month, day} or null. Handles dd/mm (day first) per Indian format. */
function parseDayMonth(s: string): { m: number; d: number } | null {
  // numeric: 5/1, 05-01, 5.1
  let mm = s.match(/\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\b/)
  if (mm) {
    const d = Number(mm[1])
    const m = Number(mm[2])
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return { m, d }
    if (m >= 1 && m <= 31 && d >= 1 && d <= 12) return { m: d, d: m } // ambiguous fallback
    return null
  }
  // "5 Jan" / "5th Jan" / "Jan 5"
  mm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i)
  if (mm) {
    const mi = MONTHS.indexOf(mm[2].toLowerCase().slice(0, 3))
    const d = Number(mm[1])
    if (mi >= 0 && d >= 1 && d <= 31) return { m: mi + 1, d }
  }
  mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (mm) {
    const mi = MONTHS.indexOf(mm[1].toLowerCase().slice(0, 3))
    const d = Number(mm[2])
    if (mi >= 0 && d >= 1 && d <= 31) return { m: mi + 1, d }
  }
  return null
}

const KEYWORD = /(submission|submit|deadline|due|last date|final date|hand ?in|to be submitted|test|exam|quiz|presentation|upload)/i

/** Core sentence that becomes the deadline title: strip dates & keywords. */
function cleanTitle(line: string, dueIdx: number): string {
  let t = line
  // remove the matched date span conservatively: cut the whole date token area
  t = t.replace(/\b\d{1,2}\s*[/.\-]\s*\d{1,2}\b/g, '')
  t = t.replace(/\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi, '')
  t = t.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(st|nd|rd|th)?/gi, '')
  t = t.replace(KEYWORD, '')
  t = t.replace(/[–—-]\s*$/, '').replace(/^\s*[–—:-]+/, '')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/[,;:.!–—-]+\s*$/, '').trim()
  void dueIdx
  return t
}

/** Extract candidate deadlines from a pasted message. */
export function extractDeadlines(text: string, today: DateStr): ExtractedDeadline[] {
  const out: ExtractedDeadline[] = []
  const seen = new Set<string>()
  const ty = Number(today.slice(0, 4))

  // Split into segments: lines, but also join wrapped lines that contain no date
  // but the previous segment had a keyword (simple two-pass approach below).
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const dm = parseDayMonth(line)
    if (!dm) continue
    const hasKeyword = KEYWORD.test(line)
    if (!hasKeyword) continue

    // roll year: if resulting date is > 6 months before today, assume next year
    let y = ty
    let cand = new Date(y, dm.m - 1, dm.d)
    const now = new Date(today + 'T00:00:00')
    if (cand.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 183) {
      y += 1
      cand = new Date(y, dm.m - 1, dm.d)
    }
    const rolled = y !== ty
    const dueDate = toDateStr(cand.getFullYear(), cand.getMonth() + 1, cand.getDate())

    let title = cleanTitle(line, i)
    // If title too short, try merging with previous line (e.g. heading above date line)
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
      subjectHint: matchSubject(line),
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

export function matchSubject(line: string): string | undefined {
  for (const [re, name] of SUBJECT_HINTS) {
    if (re.test(line)) return name
  }
  return undefined
}
