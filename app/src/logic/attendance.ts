// ============================================================
// Attendance core — plain code on the phone, fixed formulas.
// B2:  percentage = attended ÷ held × 100; No class counts in neither.
// B4:  can miss N = floor((100×attended − min×held) ÷ min)
// B5:  back to X%: N = ceil((min×held − 100×attended) ÷ (100 − min))
// J4/J5: past unmarked classes count at the assumed % (rounded to
//        nearest whole class); marked ones are exact and leave the
//        assumed pool. B8/J6: typed totals replace everything.
// Data rules: attended ≤ held, both ≥ 0; timetable edits apply from
//        their validFrom onward (past days keep what they had).
// ============================================================

import type { AppData, DateStr, MarkStatus, Slot, Subject } from '../data/model'
import { slotMatchesBatch } from '../data/model'
import { addDays, weekdayOf } from './dates'

/** Slots that were scheduled on a given date, honouring validFrom/validUntil (A8),
 *  Sunday off unless enabled (A13), and the user's batch selection (batch rule:
 *  untagged slots are whole-class; other batches of the division are hidden). */
export function slotsForDate(data: AppData, date: DateStr): Slot[] {
  const wd = weekdayOf(date)
  if (wd === 7 && !data.settings.sundayClasses) return []
  return data.slots.filter(
    (s) =>
      s.weekday === wd &&
      date >= s.validFrom &&
      (s.validUntil === null || date <= s.validUntil) &&
      slotMatchesBatch(s.batch, data.settings.myBatch),
  )
}

/** True when the date falls inside a holiday range (A12). Exam days DO count
 *  as normal classes (section J), so isExamDay holidays are not no-class days. */
export function isHoliday(data: AppData, date: DateStr): boolean {
  return data.holidays.some(
    (h) => !h.isExamDay && date >= h.startDate && date <= h.endDate,
  )
}

export function markFor(data: AppData, date: DateStr, slotId: string): MarkStatus | null {
  const m = data.marks.find((mk) => mk.date === date && mk.slotId === slotId)
  return m ? m.status : null
}

/** All dates from `from` up to and including `to`. */
export function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  let d = from
  while (d <= to) {
    out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export interface SubjectTotals {
  subjectId: string
  /** Classes counted as held (No class excluded). */
  held: number
  /** Classes attended. */
  attended: number
  /** Held classes with no mark yet that fall before today (assumed pool). */
  unmarkedPast: number
  /** Whether B8 typed totals were used. */
  usesTypedTotals: boolean
}

/**
 * Compute held/attended for one subject over a date range.
 * - Marks inside the range are counted exactly.
 * - Past (before `today`) unmarked scheduled classes count toward held, and
 *   contribute round(assumed% × count) attended (J5) — unless the subject has
 *   typed ERP totals, which replace all of it (B8/J6).
 * - Future unmarked classes are not counted at all.
 */
export function computeSubjectTotals(
  data: AppData,
  subjectId: string,
  rangeStart: DateStr,
  rangeEnd: DateStr,
  today: DateStr,
): SubjectTotals {
  const subj = data.subjects.find((s) => s.id === subjectId)
  let held = 0
  let attended = 0
  let unmarkedPast = 0

  for (const date of eachDay(rangeStart, rangeEnd)) {
    if (isHoliday(data, date)) continue
    for (const slot of slotsForDate(data, date)) {
      if (slot.subjectId !== subjectId) continue
      const status = markFor(data, date, slot.id)
      if (status === 'noclass' || status === 'cancelled') continue // B2: counts in neither
      held += 1
      if (status === 'present') attended += 1
      else if (status === 'absent') {
        /* not attended */
      } else {
        // unmarked
        if (date < today) unmarkedPast += 1
        else if (data.settings.unmarkedAsPresent) attended += 1 // B14 (Stretch setting)
      }
    }
  }

  // J5: assumed attendance for past unmarked classes.
  const assumedPct = data.settings.assumedPastAttendance
  attended += Math.round((assumedPct / 100) * unmarkedPast)

  const usesTyped = subj?.typedHeld !== undefined
  if (usesTyped && subj) {
    held = Math.max(0, subj.typedHeld ?? 0)
    attended = Math.min(held, Math.max(0, subj.typedAttended ?? 0))
  }

  // Data rule: attended never exceeds held, neither below 0.
  attended = Math.max(0, Math.min(attended, held))
  held = Math.max(0, held)

  return { subjectId, held, attended, unmarkedPast, usesTypedTotals: usesTyped }
}

export interface AttendanceSummary {
  subjectId: string
  name: string
  shortName: string
  held: number
  attended: number
  /** Percentage, unrounded value kept separately for maths. */
  percent: number
  threshold: number
  status: 'safe' | 'limit' | 'below' | 'nodata'
  /** Friendly line per B4/B5/B7. */
  message: string
  /** N in "you can miss N more classes"; 0 otherwise. */
  canMiss: number
  /** N in "attend the next N classes" (B5); only when below. */
  mustAttendNext: number
  /** Whether at least 5 classes are marked for this subject (B7 warning gate). */
  enoughMarks: boolean
}

function effectiveThreshold(data: AppData, subject: Subject): number {
  return subject.thresholdOverride ?? data.settings.threshold
}

export function summarizeSubject(
  data: AppData,
  subjectId: string,
  totals: SubjectTotals,
): AttendanceSummary {
  const subject = data.subjects.find((s) => s.id === subjectId)!
  const t = effectiveThreshold(data, subject)
  const { held, attended } = totals
  const percent = held === 0 ? 0 : (attended / held) * 100

  // Count how many classes the user actually marked (for the B7 gate).
  let markedCount = 0
  for (const m of data.marks) {
    const slot = data.slots.find((sl) => sl.id === m.slotId)
    if (slot && slot.subjectId === subjectId && m.status !== 'noclass' && m.status !== 'cancelled') markedCount += 1
  }
  const enoughMarks = totals.usesTypedTotals || markedCount >= 5

  let status: AttendanceSummary['status'] = 'nodata'
  let message = ''
  let canMiss = 0
  let mustAttendNext = 0

  if (held === 0) {
    message = 'No classes recorded yet.'
  } else {
    if (percent >= t) {
      // B4: N = floor((100×A − min×H) ÷ min)
      const n = Math.floor(((100 * attended - t * held) / t))
      status = n === 0 ? 'limit' : 'safe'
      if (n === 0) message = 'At the limit. Don\u2019t miss the next class'
      else message = `You\u2019re safe! You can skip ${n} more class${n === 1 ? '' : 'es'}`
      canMiss = Math.max(0, n)
    } else {
      status = 'below'
      if (t >= 100) {
        mustAttendNext = 0
        message = `Below ${t}% and it cannot be recovered by attending alone.`
      } else {
        // B5: N = ceil((min×H − 100×A) ÷ (100 − min))
        mustAttendNext = Math.ceil((t * held - 100 * attended) / (100 - t))
        message = `Attend the next ${mustAttendNext} class${mustAttendNext === 1 ? '' : 'es'} to get back to ${t}%`
      }
    }
  }

  return {
    subjectId,
    name: subject.fullName,
    shortName: subject.shortName,
    held,
    attended,
    percent,
    threshold: t,
    status,
    message,
    canMiss,
    mustAttendNext,
    enoughMarks,
  }
}

export function overallPercent(summaries: AttendanceSummary[]): number {
  const held = summaries.reduce((a, s) => a + s.held, 0)
  const attended = summaries.reduce((a, s) => a + s.attended, 0)
  return held === 0 ? 0 : (attended / held) * 100
}

/** Everything the UI needs, recomputed from marks + timetable + settings.
 *  Never stored (data model rule). */
export interface AttendanceReport {
  bySubject: AttendanceSummary[]
  overall: number
  /** Subjects below threshold with enough marks to warn (B7). */
  warnings: AttendanceSummary[]
}

export function buildReport(
  data: AppData,
  today: DateStr,
  rangeStart: DateStr,
  rangeEnd: DateStr,
): AttendanceReport {
  const bySubject = data.subjects.map((subj) => {
    const totals = computeSubjectTotals(data, subj.id, rangeStart, rangeEnd, today)
    return summarizeSubject(data, subj.id, totals)
  })
  const overall = overallPercent(bySubject)
  const warnings = bySubject.filter((s) => s.status === 'below' && s.enoughMarks)
  return { bySubject, overall, warnings }
}
