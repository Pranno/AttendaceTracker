// Date helpers. All dates are stored as YYYY-MM-DD (data model rule),
// shown day first ("9 Nov", "09/11") per the Key decisions table.

import type { DateStr } from '../data/model'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayStr(): DateStr {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function toDate(dateStr: DateStr): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fromDate(d: Date): DateStr {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function addDays(dateStr: DateStr, days: number): DateStr {
  const d = toDate(dateStr)
  d.setDate(d.getDate() + days)
  return fromDate(d)
}

/** Difference in whole days: b − a. */
export function diffDays(a: DateStr, b: DateStr): number {
  const ms = toDate(b).getTime() - toDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(dateStr: DateStr): number {
  const dow = toDate(dateStr).getDay() // 0 = Sunday
  return dow === 0 ? 7 : dow
}

/** "9 Nov" or "9 Nov 2026" — day first. */
export function formatShort(dateStr: DateStr, withYear = false): string {
  const d = toDate(dateStr)
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return withYear ? `${base} ${d.getFullYear()}` : base
}

/** "Mon" … "Sun". */
export function weekdayName(weekday: number): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday - 1] ?? '?'
}

export function monthKey(dateStr: DateStr): string {
  return dateStr.slice(0, 7) // YYYY-MM
}

/** First day of the month after the given date's month. J2 plan start. */
export function nextMonthFirstDay(dateStr: DateStr): DateStr {
  const d = toDate(dateStr)
  return fromDate(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

/** Number of days in a given YYYY-MM month. */
export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Friendly "in N days" / "N days ago" / "today" line. */
export function relativeDay(target: DateStr, from: DateStr): string {
  const n = diffDays(from, target)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 1) return `in ${n} days`
  return `${-n} days ago`
}
