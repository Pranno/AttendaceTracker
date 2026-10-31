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

import type { AppData, Conversion, DateStr, MarkStatus, Slot, Subject } from '../data/model'
import { slotMatchesBatch } from '../data/model'
import { addDays, weekdayOf } from './dates'

/** Stretch #5: the subject a converted lecture really belongs to on this date. */
export function conversionFor(data: AppData, date: DateStr, slotId: string): Conversion | undefined {
  return data.conversions.find((c) => c.date === date && c.slotId === slotId)
}

/** The subject a class on `date`/`slot` actually counts toward: the converted
 *  target when the period was swapped ("WAD became FE"), otherwise the slot's
 *  own subject. Attendance marked on a converted class lands here. */
export function effectiveSubjectId(data: AppData, date: DateStr, slot: Slot): string {
  const conv = conversionFor(data, date, slot.id)
  return conv ? conv.subjectId : slot.subjectId
}

/** Slots that were scheduled on a given date, honouring validFrom/validUntil (A8),
 *  Sunday off unless enabled (A13), and the user's batch selection (batch rule:
 *  untagged slots are whole-class; other batches of the division are hidden). */
export function slotsForDate(data: AppData, date: DateStr): Slot[] {
  const wd = weekdayOf(date)
  if (wd === 7 && !data.settings.sundayClasses) return []
  return mergeLabPairs(
    data.slots.filter(
      (s) =>
        s.weekday === wd &&
        date >= s.validFrom &&
        (s.validUntil === null || date <= s.validUntil) &&
        slotMatchesBatch(s.batch, data.settings.myBatch),
    ),
  )
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** College rule: practical/lab lectures run as ONE session spanning two
 *  consecutive periods with a single attendance (e.g. FE lab 10:15–12:15 is
 *  one session). Timetables often store such a lab as two back-to-back slots
 *  of the same subject/type/batch/teacher — merge them into one counted
 *  session whose end time is the later one, so held/attended never double up.
 *  The merged slot keeps the FIRST slot's id, which is what Today/Calendar
 *  mark buttons write to, so marking stays a single tap per lab. */
export function mergeLabPairs(slots: Slot[]): Slot[] {
  const out: Slot[] = []
  for (const s of [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.type === 'lab' &&
      s.type === 'lab' &&
      prev.subjectId === s.subjectId &&
      prev.endTime === s.startTime &&
      (prev.batch ?? '') === (s.batch ?? '') &&
      prev.teacher === s.teacher
    ) {
      out[out.length - 1] = { ...prev, endTime: s.endTime > prev.endTime ? s.endTime : prev.endTime }
      continue
    }
    out.push(s)
  }
  // A lab already stored as one long block (>= ~90 min) is fine as-is; nothing
  // else to do. Sanity guard: drop zero/negative-duration artifacts.
  return out.filter((s) => mins(s.endTime) > mins(s.startTime) || s.startTime === s.endTime)
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
  /** Stretch #5: converted periods counted toward this subject in the range. */
  convertedCount: number
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
  // "Start fresh" mode (F-settings): ignore everything before today — no
  // carry-over, no assumed past attendance. Marks made from today onward are
  // still counted normally.
  const ignorePast = !!data.settings.ignorePastAttendance
  if (ignorePast && rangeStart < today) rangeStart = today
  let held = 0
  let attended = 0
  let unmarkedPast = 0

  for (const date of eachDay(rangeStart, rangeEnd)) {
    if (isHoliday(data, date)) continue
    for (const slot of slotsForDate(data, date)) {
      // Stretch #5: a converted period counts toward the subject that actually
      // took it ("WAD became FE" → held+attended land on FE's totals).
      const owner = effectiveSubjectId(data, date, slot)
      if (owner !== subjectId) continue
      const status = markFor(data, date, slot.id)
      if (status === 'noclass' || status === 'cancelled') continue // B2: counts in neither
      // Start-fresh: only marks the user actually made count; scheduled-but-
      // unmarked classes before today are skipped entirely.
      if (ignorePast && date < today && status === null) continue
      held += 1
      if (status === 'present' || status === 'converted') attended += 1
      else if (status === 'absent') {
        /* not attended */
      } else {
        // unmarked
        if (date < today) unmarkedPast += 1
        else if (data.settings.unmarkedAsPresent) attended += 1 // B14 (Stretch setting)
      }
    }
  }

  // J5: assumed attendance for past unmarked classes (skipped in start-fresh mode).
  const assumedPct = ignorePast ? 0 : data.settings.assumedPastAttendance
  attended += Math.round((assumedPct / 100) * unmarkedPast)

  const usesTyped = !ignorePast && subj?.typedHeld !== undefined
  if (usesTyped && subj) {
    held = Math.max(0, subj.typedHeld ?? 0)
    attended = Math.min(held, Math.max(0, subj.typedAttended ?? 0))
  }

  // Data rule: attended never exceeds held, neither below 0.
  attended = Math.max(0, Math.min(attended, held))
  held = Math.max(0, held)

  // Stretch #5: count converted periods owned by this subject (for the note).
  let convertedCount = 0
  for (const c of data.conversions) {
    if (c.subjectId === subjectId && c.date >= rangeStart && c.date <= rangeEnd && !isHoliday(data, c.date)) {
      const slot = data.slots.find((sl) => sl.id === c.slotId)
      if (slot && slot.subjectId !== subjectId) convertedCount += 1
    }
  }

  // Stretch #5: a typed ERP total already includes any swapped lectures, so
  // don't show the "converted" note when B8 totals replace the calculation.
  if (usesTyped) convertedCount = 0

  return { subjectId, held, attended, unmarkedPast, usesTypedTotals: usesTyped, convertedCount }
}

export interface AttendanceSummary {
  subjectId: string
  name: string
  shortName: string
  held: number
  attended: number
  /** Stretch #5: how many of the counted classes were converted periods
   *  (another subject's slot swapped into this one, e.g. FE taking WAD's
   *  period). Shown as a small note on the subject card. */
  convertedCount: number
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

export function effectiveThreshold(data: AppData, subject: Subject): number {
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
    if (slot && effectiveSubjectId(data, m.date, slot) === subjectId && m.status !== 'noclass' && m.status !== 'cancelled') markedCount += 1
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
    convertedCount: totals.convertedCount,
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

/** Apply the "start fresh" F-setting to a data snapshot so every computed
 *  view (reports, totals) honours it. UI screens wrap their `data` with this;
 *  pure tests keep using raw data (the flag defaults to false). */
export function freshData(data: AppData): AppData {
  return data.settings.ignorePastAttendance ? { ...data, settings: { ...data.settings, ignorePastAttendance: true } } : data
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
