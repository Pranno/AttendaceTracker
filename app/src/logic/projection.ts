// ============================================================
// Monthly Attendance Plan engine (Section J)
// Pure code on the device with fixed formulas:
//
// Before the month:
//   H = classes held and A = classes attended up to end of previous month
//   (marks, ERP typed totals B8/J6, and J5 assumed past attendance).
//
// Classes in the month (C):
//   timetable classes in month minus holidays (A12) minus 'noclass'/'cancelled'.
//   (Exam days count as normal classes).
//
// Done so far this month:
//   p = classes marked Present, a = classes marked Absent.
//   Classes left: R = C - p - a.
//
// Needed by end of month:
//   smallest whole number of attended classes to stay >= threshold t:
//   ceil(t * (H + C) / 100).
//
// Must attend (N):
//   max(0, needed - (A + p)).
//
// Can skip:
//   R - N.
//
// Out of reach:
//   when N > R. Can skip = 0.
//   Achievable end-of-month percentage: (A + p + R) / (H + C) * 100 (1 dec).
// ============================================================

import type { AppData, DateStr, Slot } from '../data/model'
import { slotMatchesBatch } from '../data/model'
import { computeSubjectTotals, conversionFor, effectiveSubjectId, isHoliday, markFor } from './attendance'
import { addDays, daysInMonth, monthKey, pad2, weekdayOf } from './dates'

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Raw (unmerged) slots scheduled for a date, honouring validFrom/validUntil,
 *  Sundays and batch. Kept unmerged on purpose: lab-pair merging happens
 *  separately below so that a pair already stored as ONE long block (e.g. an
 *  imported PDF timetable: 10:15–12:15) is NOT swallowed by merging with its
 *  neighbour period the way attendance.ts's full pipeline would. */
function rawSlotsOnDate(data: AppData, date: DateStr): Slot[] {
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

/** Mark-aware lab-pair deduplication (college rule: one practical spanning
 *  two consecutive periods = ONE counted session). Unlike mergeLabPairs it
 *  only collapses a back-to-back pair when BOTH halves share the same mark
 *  status — because Today/Calendar write marks per period, so two differently
 *  marked halves are genuinely two sessions for the projection. Long blocks
 *  (>= ~90 min) count as one session on their own. */
function rawSlotsForDate(data: AppData, date: DateStr): Slot[] {
  const sorted = [...rawSlotsOnDate(data, date)].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const out: Slot[] = []
  for (const s of sorted) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.type === 'lab' &&
      s.type === 'lab' &&
      prev.subjectId === s.subjectId &&
      prev.endTime === s.startTime &&
      (prev.batch ?? '') === (s.batch ?? '') &&
      prev.teacher === s.teacher &&
      markFor(data, date, prev.id) === markFor(data, date, s.id)
    ) {
      // Keep the first slot's id — that's where Today/Calendar store the mark.
      out[out.length - 1] = { ...prev, endTime: s.endTime > prev.endTime ? s.endTime : prev.endTime }
      continue
    }
    out.push(s)
  }
  // Sanity guard: drop zero/negative-duration artifacts.
  return out.filter((s) => mins(s.endTime) > mins(s.startTime) || s.startTime === s.endTime)
}

/** The subject a period on `date`/`slot` counts toward (converted target wins). */
function ownerOf(data: AppData, date: DateStr, slot: Slot): string {
  const conv = conversionFor(data, date, slot.id)
  return conv ? conv.subjectId : slot.subjectId
}

export interface SubjectMonthPlan {
  subjectId: string
  shortName: string
  fullName: string
  monthKey: string // "YYYY-MM"
  threshold: number
  /** H: held before this month */
  priorHeld: number
  /** A: attended before this month */
  priorAttended: number
  /** C: scheduled classes in this month (minus holidays & no-class) */
  classesInMonth: number
  /** p: marked Present this month */
  presentInMonth: number
  /** a: marked Absent this month */
  absentInMonth: number
  /** R: classes left in this month (C - p - a) */
  classesLeft: number
  /** Needed by end of month: ceil(t * (H + C) / 100) */
  neededTotal: number
  /** N: must attend = max(0, needed - (A + p)) */
  mustAttend: number
  /** Can skip: R - N (0 when out of reach) */
  canSkip: number
  outOfReach: boolean
  /** Percentage user will end on if attending all remaining R classes */
  endPercent: number | null
  status: 'safe' | 'limit' | 'below' | 'nodata'
  verdict: string
  kind: 'projection' | 'current' | 'finished'
}

export interface MonthPlan {
  monthKey: string
  subjects: SubjectMonthPlan[]
}

/** All valid plan months from planStartMonth (or current) up to semesterEnd (J1, J2, J13). */
export function planMonths(data: AppData, today: DateStr): string[] {
  const currentMk = monthKey(today)
  const startMk = data.settings.planStartMonth ?? (data.settings.semesterStart ? monthKey(data.settings.semesterStart) : currentMk)
  const endMk = data.settings.semesterEnd ? monthKey(data.settings.semesterEnd) : currentMk

  const effectiveStart = startMk < endMk ? startMk : endMk
  const effectiveEnd = endMk >= effectiveStart ? endMk : effectiveStart

  const [sy, sm] = effectiveStart.split('-').map(Number)
  const [ey, em] = effectiveEnd.split('-').map(Number)

  const out: string[] = []
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad2(m)}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }

  // Ensure current month is always present
  if (!out.includes(currentMk)) {
    out.push(currentMk)
    out.sort()
  }

  return out
}

/** Calculate Section J monthly plan for one subject in a specific month.
 *  `options.ignorePast` = "start fresh" mode (F-settings toggle): nothing
 *  before today counts — no ERP carry-over, no assumed past attendance.
 *  Defaults to the user's saved setting; tests can pass an explicit value. */
export function projectSubjectMonth(
  data: AppData,
  subjectId: string,
  targetMonthKey: string,
  today: DateStr,
  options?: { ignorePast?: boolean },
): SubjectMonthPlan {
  const subj = data.subjects.find((s) => s.id === subjectId)!
  const threshold = subj.thresholdOverride ?? data.settings.threshold

  // Start-fresh: computeSubjectTotals must also skip pre-today history.
  const effData =
    options?.ignorePast ?? data.settings.ignorePastAttendance
      ? { ...data, settings: { ...data.settings, ignorePastAttendance: true } }
      : data

  const currentMk = monthKey(today)
  const isProjection = targetMonthKey > currentMk
  const isFinished = targetMonthKey < currentMk
  const kind: SubjectMonthPlan['kind'] = isProjection ? 'projection' : isFinished ? 'finished' : 'current'

  // Month date range
  const daysCount = daysInMonth(targetMonthKey)
  const monthStart: DateStr = `${targetMonthKey}-01`
  let monthEnd: DateStr = `${targetMonthKey}-${pad2(daysCount)}`

  // J11/J13: Last month counts classes only up to semester end date
  if (data.settings.semesterEnd && data.settings.semesterEnd < monthEnd) {
    if (data.settings.semesterEnd >= monthStart) {
      monthEnd = data.settings.semesterEnd
    }
  }

  // 1. Before the month: H = held, A = attended up to the end of the previous month (J5, B8/J6)
  const semStart = data.settings.semesterStart ?? monthStart
  const prevMonthEnd = addDays(monthStart, -1)

  let priorHeld = 0
  let priorAttended = 0

  // "Start fresh" mode (F-settings toggle): nothing before today counts — no
  // ERP carry-over, no assumed past attendance. The month plan builds only
  // from marks made today onward.
  const ignorePast = options?.ignorePast ?? data.settings.ignorePastAttendance

  if (ignorePast) {
    // Standing up to prevMonthEnd: only classes already marked count.
    if (prevMonthEnd >= semStart) {
      const priorTotals = computeSubjectTotals(effData, subjectId, semStart, prevMonthEnd < today ? prevMonthEnd : today, today)
      priorHeld = priorTotals.held
      priorAttended = priorTotals.attended
    }
  } else if (subj.typedHeld !== undefined && !isProjection) {
    // B8 / J6: Typed ERP totals replace assumed/calculated totals
    priorHeld = Math.max(0, subj.typedHeld ?? 0)
    priorAttended = Math.min(priorHeld, Math.max(0, subj.typedAttended ?? 0))
  } else if (prevMonthEnd >= semStart) {
    // Compute standing before this month
    if (!isProjection) {
      // For current or past month, evaluate exact standing up to prevMonthEnd
      const priorTotals = computeSubjectTotals(effData, subjectId, semStart, prevMonthEnd, today)
      priorHeld = priorTotals.held
      priorAttended = priorTotals.attended
    } else {
      // J11: For a month that has not started, assume every class before it is attended
      // Standing up to today:
      const priorTotals = computeSubjectTotals(effData, subjectId, semStart, today, today)
      priorHeld = priorTotals.held
      priorAttended = priorTotals.attended

      // Walk from tomorrow to prevMonthEnd assuming all classes are attended
      let walk = addDays(today, 1)
      while (walk <= prevMonthEnd) {
        if (!isHoliday(data, walk)) {
          const slots = rawSlotsForDate(data, walk).filter((sl) => ownerOf(data, walk, sl) === subjectId)
          for (const slot of slots) {
            const m = markFor(data, walk, slot.id)
            if (m === 'noclass' || m === 'cancelled') continue
            priorHeld += 1
            priorAttended += 1 // J11 assumption: attended
          }
        }
        walk = addDays(walk, 1)
      }
    }
  }

  // 2. Classes in the month (C): weekly timetable minus holidays, minus 'noclass'/'cancelled'
  let classesInMonth = 0
  let presentInMonth = 0
  let absentInMonth = 0

  let d = monthStart
  while (d <= monthEnd) {
    const holiday = isHoliday(data, d)
    if (!holiday) {
      const slots = rawSlotsForDate(data, d).filter((sl) => ownerOf(data, d, sl) === subjectId)
      for (const slot of slots) {
        const status = markFor(data, d, slot.id)
        if (status === 'noclass' || status === 'cancelled') {
          // Excluded from held & classes in month
          continue
        }
        classesInMonth += 1
        if (status === 'present' || status === 'converted') presentInMonth += 1
        else if (status === 'absent') absentInMonth += 1
      }
    }
    d = addDays(d, 1)
  }

  // R: Classes left in the month
  const classesLeft = Math.max(0, classesInMonth - presentInMonth - absentInMonth)

  // 3. Section J Attendance Formulas
  if (classesInMonth === 0 && priorHeld === 0) {
    // J14: No classes this month
    return {
      subjectId,
      shortName: subj.shortName,
      fullName: subj.fullName,
      monthKey: targetMonthKey,
      threshold,
      priorHeld: 0,
      priorAttended: 0,
      classesInMonth: 0,
      presentInMonth: 0,
      absentInMonth: 0,
      classesLeft: 0,
      neededTotal: 0,
      mustAttend: 0,
      canSkip: 0,
      outOfReach: false,
      endPercent: null,
      status: 'nodata',
      verdict: 'No classes this month',
      kind,
    }
  }

  // Needed by end of month: ceil(t * (H + C) / 100)
  const totalHeldAtMonthEnd = priorHeld + classesInMonth
  const neededTotal = Math.ceil((threshold * totalHeldAtMonthEnd) / 100)

  // Must attend N: max(0, needed - (A + p))
  const alreadyAttended = priorAttended + presentInMonth
  const mustAttend = Math.max(0, neededTotal - alreadyAttended)

  // Can skip: R - N
  const canSkip = classesLeft - mustAttend

  let outOfReach = false
  let endPercent: number | null = null
  let status: SubjectMonthPlan['status'] = 'safe'
  let verdict = ''

  if (mustAttend > classesLeft) {
    // Out of reach: even attending all R classes is not enough
    outOfReach = true
    const maxAttainable = alreadyAttended + classesLeft
    endPercent = totalHeldAtMonthEnd > 0
      ? Math.round(((maxAttainable / totalHeldAtMonthEnd) * 100) * 10) / 10
      : 0
    status = 'below'
    verdict = `Out of reach this month. Attend all ${classesLeft} to reach ${endPercent.toFixed(1)}%`
  } else if (canSkip === 0) {
    status = 'limit'
    verdict = "At the limit. Don't miss the next class"
  } else {
    status = 'safe'
    verdict = `You can skip ${canSkip} more. Nice!`
  }

  return {
    subjectId,
    shortName: subj.shortName,
    fullName: subj.fullName,
    monthKey: targetMonthKey,
    threshold,
    priorHeld,
    priorAttended,
    classesInMonth,
    presentInMonth,
    absentInMonth,
    classesLeft,
    neededTotal,
    mustAttend,
    canSkip: Math.max(0, canSkip),
    outOfReach,
    endPercent,
    status,
    verdict,
    kind,
  }
}

/** Build full month plan for all subjects for a given month (J1: per subject only, no overall total). */
export function buildMonthPlan(
  data: AppData,
  targetMonthKey: string,
  today: DateStr,
  options?: { ignorePast?: boolean },
): MonthPlan {
  const subjects = data.subjects.map((s) => projectSubjectMonth(data, s.id, targetMonthKey, today, options))
  return {
    monthKey: targetMonthKey,
    subjects,
  }
}
