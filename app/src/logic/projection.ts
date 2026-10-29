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

import type { AppData, DateStr } from '../data/model'
import { computeSubjectTotals, isHoliday, markFor, slotsForDate } from './attendance'
import { addDays, daysInMonth, monthKey, pad2 } from './dates'

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

/** Calculate Section J monthly plan for one subject in a specific month. */
export function projectSubjectMonth(
  data: AppData,
  subjectId: string,
  targetMonthKey: string,
  today: DateStr,
): SubjectMonthPlan {
  const subj = data.subjects.find((s) => s.id === subjectId)!
  const threshold = subj.thresholdOverride ?? data.settings.threshold

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

  if (subj.typedHeld !== undefined) {
    // B8 / J6: Typed ERP totals replace assumed/calculated totals
    priorHeld = Math.max(0, subj.typedHeld ?? 0)
    priorAttended = Math.min(priorHeld, Math.max(0, subj.typedAttended ?? 0))
  } else if (prevMonthEnd >= semStart) {
    // Compute standing before this month
    if (!isProjection) {
      // For current or past month, evaluate exact standing up to prevMonthEnd
      const priorTotals = computeSubjectTotals(data, subjectId, semStart, prevMonthEnd, today)
      priorHeld = priorTotals.held
      priorAttended = priorTotals.attended
    } else {
      // J11: For a month that has not started, assume every class before it is attended
      // Standing up to today:
      const priorTotals = computeSubjectTotals(data, subjectId, semStart, today, today)
      priorHeld = priorTotals.held
      priorAttended = priorTotals.attended

      // Walk from tomorrow to prevMonthEnd assuming all classes are attended
      let walk = addDays(today, 1)
      while (walk <= prevMonthEnd) {
        if (!isHoliday(data, walk)) {
          const slots = slotsForDate(data, walk).filter((sl) => sl.subjectId === subjectId)
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
      const slots = slotsForDate(data, d).filter((sl) => sl.subjectId === subjectId)
      for (const slot of slots) {
        const status = markFor(data, d, slot.id)
        if (status === 'noclass' || status === 'cancelled') {
          // Excluded from held & classes in month
          continue
        }
        classesInMonth += 1
        if (status === 'present') presentInMonth += 1
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
export function buildMonthPlan(data: AppData, targetMonthKey: string, today: DateStr): MonthPlan {
  const subjects = data.subjects.map((s) => projectSubjectMonth(data, s.id, targetMonthKey, today))
  return {
    monthKey: targetMonthKey,
    subjects,
  }
}
