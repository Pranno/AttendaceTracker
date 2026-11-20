// Holiday notices in pasted college messages (Standard / offline reader).
// "College will remain closed on 25/11 on account of Guru Nanak Jayanti",
// "Diwali vacation from 10th to 15th November", "No lectures on 3/12" …
// → { label, startDate, endDate }. Reviewed by the user before saving.

import type { DateStr } from '../data/model'

export interface ExtractedHoliday {
  label: string
  startDate: DateStr
  endDate: DateStr
  /** true when the year wasn't written and we picked next year */
  tentative: boolean
  sourceLine: string
}

/** A line announcing that classes are off. */
export const HOLIDAY_RE =
  /\b(holidays?|vacation|vacations|(?:will )?(?:remain )?closed|no (?:lectures?|classes|college)|lectures? (?:will )?not be (?:conducted|held)|classes (?:are |will be )?(?:suspended|cancelled|canceled|off)|college (?:is |will be )?off|declared (?:a )?(?:holiday|off)|diwali break|winter break|summer break|mid[- ]?term break|puja break|festive break)\b/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
const ORD = '(?:st|nd|rd|th)?'
const pad = (n: number) => String(n).padStart(2, '0')

interface DM { d: number; m: number; y?: number; at: number }

/** Every date written in the line, in order of appearance. */
function datesIn(line: string): DM[] {
  const out: DM[] = []
  const year = (s?: string) => (s ? (Number(s) < 100 ? 2000 + Number(s) : Number(s)) : undefined)
  // "10th to 15th November [2026]" / "10-15 Nov" — a day range inside one month
  for (const m of line.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}\\s*(?:to|till|until|-|–|—)\\s*(\\d{1,2})${ORD}\\s+${MON}(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    const mo = MONTHS.indexOf(m[3].toLowerCase().slice(0, 3)) + 1
    out.push({ d: Number(m[1]), m: mo, y: year(m[4]), at: m.index ?? 0 }, { d: Number(m[2]), m: mo, y: year(m[4]), at: (m.index ?? 0) + 1 })
  }
  if (out.length) return out
  // 25/11, 25.11.2026, 9-11-2026
  for (const m of line.matchAll(/\b(\d{1,2})\s*[/.]\s*(\d{1,2})(?:[/.](\d{2,4}))?\b(?!\s*(?:am|pm|hrs?)\b)/gi)) {
    out.push({ d: Number(m[1]), m: Number(m[2]), y: year(m[3]), at: m.index ?? 0 })
  }
  for (const m of line.matchAll(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g)) out.push({ d: Number(m[1]), m: Number(m[2]), y: year(m[3]), at: m.index ?? 0 })
  // 25th Nov [2026] / Nov 25 [2026]
  for (const m of line.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MON}(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    out.push({ d: Number(m[1]), m: MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)) + 1, y: year(m[3]), at: m.index ?? 0 })
  }
  for (const m of line.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2})${ORD}\\b(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    out.push({ d: Number(m[2]), m: MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, y: year(m[3]), at: m.index ?? 0 })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Resolve to a real calendar date; a missing year means the next such date (within ~6 months back). */
function resolve(dm: DM, today: DateStr): { date: DateStr; rolled: boolean } | null {
  if (dm.m < 1 || dm.m > 12 || dm.d < 1 || dm.d > 31) return null
  const ty = Number(today.slice(0, 4))
  let y = dm.y ?? ty
  let dt = new Date(y, dm.m - 1, dm.d)
  if (dt.getMonth() !== dm.m - 1) return null // 31/02 etc.
  if (!dm.y && dt.getTime() < new Date(`${today}T00:00:00`).getTime() - 183 * 86_400_000) {
    y += 1
    dt = new Date(y, dm.m - 1, dm.d)
  }
  return { date: `${y}-${pad(dm.m)}-${pad(dm.d)}`, rolled: !dm.y && y !== ty }
}

function labelOf(line: string): string {
  const reason = /\b(?:on account of|due to|on the occasion of|occasion of|for|in view of|celebrat(?:e|ing))\s+(.+)$/i.exec(line)
  const clean = (t: string) =>
    t
      .replace(/\b\d{1,2}\s*[/.-]\s*\d{1,2}(?:[/.-]\d{2,4})?\b/g, '')
      .replace(new RegExp(`\\b\\d{1,2}${ORD}\\s*(?:to|till|until|-|–)?\\s*(?:\\d{1,2}${ORD}\\s+)?(?:of\\s+)?${MON}(?:,?\\s+\\d{4})?`, 'gi'), '')
      .replace(new RegExp(`\\b${MON}\\s+\\d{1,2}${ORD}(?:,?\\s+\\d{4})?`, 'gi'), '')
      .replace(/[*_~"“”]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.;:–—-]+|[\s,.;:!–—-]+$/g, '')
  if (reason) {
    const r = clean(reason[1]).replace(/^(the|a)\s+/i, '')
    if (r.length >= 3 && r.length <= 60) return r.charAt(0).toUpperCase() + r.slice(1)
  }
  const named = /\b(diwali|dussehra|christmas|holi|eid|ganesh|navratri|republic day|independence day|winter|summer|mid[- ]?term|puja)\b(?:\s+(?:break|vacations?|holidays?))?/i.exec(line)
  if (named) {
    const t = clean(named[0])
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  return 'Holiday'
}

/** Find holiday announcements in a pasted message. */
export function extractHolidays(text: string, today: DateStr): ExtractedHoliday[] {
  const out: ExtractedHoliday[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!HOLIDAY_RE.test(line)) continue
    // the dates may sit on the next line ("Diwali vacation:\n10/11 to 15/11")
    let dates = datesIn(line)
    let src = line
    if (dates.length === 0 && i + 1 < lines.length) {
      dates = datesIn(lines[i + 1])
      src = `${line} ${lines[i + 1]}`
    }
    if (dates.length === 0) continue
    const first = resolve(dates[0], today)
    if (!first) continue
    let start = first.date
    let end = first.date
    let rolled = first.rolled
    // a range: two dates with "to / till / from … to / -" between them
    if (dates.length >= 2 && /\b(to|till|until|through)\b|[-–—]/i.test(src)) {
      const second = resolve({ ...dates[1], y: dates[1].y ?? dates[0].y }, today)
      if (second) {
        // "28/12 to 2/1": the end falls in the next year
        let e = second.date
        if (e < start && !dates[1].y) e = `${Number(e.slice(0, 4)) + 1}${e.slice(4)}`
        if (e >= start) {
          end = e
          rolled = rolled || second.rolled
        }
      }
    }
    if (out.some((h) => h.startDate === start && h.endDate === end)) continue
    out.push({ label: labelOf(src), startDate: start, endDate: end, tentative: rolled, sourceLine: src.slice(0, 300) })
  }
  return out
}
