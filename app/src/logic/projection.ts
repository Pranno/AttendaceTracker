// ============================================================
// Monthly Plan projection engine (section J)
// J1: day-by-day walk forward from today to semester end.
// J2: the plan covers months from planStartMonth onward.
// J3: per subject, project held/attended into the future using the
//     weekly timetable; cancelled/noclass/holiday days excluded.
// J4/J5: past unmarked classes use the assumed %; marked ones exact.
// J6: typed ERP totals replace calculated figures for a subject.
// J7: breach date = first future date where percent drops below the
//     threshold if the user attends nothing more that subject holds.
// J8: "safe until" = last date the user can miss every class up to and
//     still stay at/above threshold on that day's projection.
// J9: skip headroom for the rest of the month per subject.
// J10: recovery — how many consecutive attendances bring it back.
// J11: weekly summary rows (held/attended/% per week).
// J12: exam days count as normal classes (isExamDay holidays not skipped).
// J13: percentages shown rounded, maths kept unrounded.
// J14: no-data subjects are listed but marked clearly, never guessed.
// ============================================================

import type { AppData, DateStr } from '../data/model'
import { isHoliday, slotsForDate, type SubjectTotals } from './attendance'

import { addDays, formatShort, monthKey, weekdayOf } from './dates'

/** Small local helper so we don't depend on export names elsewhere. */
function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  let d = from
  while (d <= to) {
    out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export interface ProjectionPoint {
  date: DateStr
  /** Held total as of this date (inclusive). */
  held: number
  attended: number
  /** Unrounded percent (0 when held = 0). */
  percent: number
}

export interface SubjectProjection {
  subjectId: string
  shortName: string
  name: string
  threshold: number
  /** Totals as of today (exact + assumed pool). */
  current: SubjectTotals
  currentPercent: number
  status: 'safe' | 'limit' | 'below' | 'nodata'
  /** Day-by-day future walk (J1), one point per scheduled-or-not date. */
  points: ProjectionPoint[]
  /** J7: first date attendance would drop below threshold if user skips
   *  everything remaining, or null if it never does within the horizon. */
  breachDate: DateStr | null
  /** J8: last date safe to be absent through (inclusive) while staying ≥ threshold. */
  safeUntil: DateStr | null
  /** J9: how many of the remaining classes in the horizon can be skipped
   *  while STILL ending at/above threshold. */
  canSkipRest: number
  /** J10: consecutive full attendances needed from tomorrow to recover. */
  mustAttendNext: number
  /** Total remaining scheduled classes in horizon. */
  remainingClasses: number
  usesTypedTotals: boolean
}

export interface WeekRow {
  /** Monday date of the week. */
  weekStart: DateStr
  held: number
  attended: number
  percent: number
}

export interface MonthPlan {
  monthKey: string
  subjects: SubjectProjection[]
  /** Overall across all subjects for the month window. */
  overallHeld: number
  overallAttended: number
  overallPercent: number
  weekly: WeekRow[]
}

function pct(a: number, h: number): number {
  return h === 0 ? 0 : (a / h) * 100
}

/** J8/J9 one-line verdict wording for a projected subject (used by Plan & Today). */
export function planVerdict(sp: {
  status: string
  breachDate: DateStr | null
  canSkipRest: number
  remainingClasses: number
}): string {
  if (sp.status === 'nodata') return 'No classes recorded yet — nothing projected.'
  if (sp.status === 'below') return 'Below threshold now — attend the next classes to recover.'
  if (sp.breachDate) return `If you skip everything left, you drop below on ${formatShort(sp.breachDate)}.`
  if (sp.canSkipRest > 0) return `You can miss up to ${sp.canSkipRest} of the ${sp.remainingClasses} remaining classes and stay at or above target.`
  return 'Zero headroom — attend every remaining class in this window.'
}

/** Project one subject from `start` (today) to `end` (semester end or month end). */
export function projectSubject(
  data: AppData,
  subjectId: string,
  start: DateStr,
  end: DateStr,
): SubjectProjection {
  const subj = data.subjects.find((s) => s.id === subjectId)!
  const threshold = subj.thresholdOverride ?? data.settings.threshold

  // Standing BEFORE the walk (exact marks only — the walk itself decides
  // what happens on and after `start`, so no assumed pool here).
  // J6: typed ERP totals replace everything.
  const subj0 = data.subjects.find((s) => s.id === subjectId)!
  const usesTyped = subj0.typedHeld !== undefined
  let held = 0
  let attended = 0
  if (usesTyped) {
    held = Math.max(0, subj0.typedHeld ?? 0)
    attended = Math.min(held, Math.max(0, subj0.typedAttended ?? 0))
  } else {
    const before = addDays(start, -1)
    const rangeBegin = data.settings.semesterStart ?? '2000-01-01'
    if (rangeBegin <= before) {
      for (const d of eachDay(rangeBegin, before)) {
        if (isHoliday(data, d)) continue
        for (const slot of slotsForDate(data, d)) {
          if (slot.subjectId !== subjectId) continue
          const m = data.marks.find((mk) => mk.date === d && mk.slotId === slot.id)
          if (!m || m.status === 'noclass' || m.status === 'cancelled') continue
          held += 1
          if (m.status === 'present') attended += 1
        }
      }
    }
  }
  const baseHeld = held
  const baseAttended = attended
  const curPct0 = pct(baseAttended, baseHeld)
  const current: SubjectTotals = { subjectId, held: baseHeld, attended: baseAttended, unmarkedPast: 0, usesTypedTotals: usesTyped }

  // Walk future dates day by day (J1/J3). Attending NOTHING from now on:
  // held grows with each scheduled class, attended stays flat.
  const points: ProjectionPoint[] = [
    { date: start, held, attended, percent: pct(attended, held) },
  ]
  let breachDate: DateStr | null = null
  let safeUntil: DateStr | null = null
  let remainingClasses = 0

  const curPct = curPct0
  if (baseHeld === 0) {
    // J14: no data at all — never guess in the projection UI.
    return {
      subjectId,
      shortName: subj.shortName,
      name: subj.fullName,
      threshold,
      current,
      currentPercent: 0,
      status: 'nodata',
      points,
      breachDate: null,
      safeUntil: null,
      canSkipRest: 0,
      mustAttendNext: 0,
      remainingClasses: 0,
      usesTypedTotals: usesTyped,
    }
  }

  if (curPct >= threshold) safeUntil = start

  let d = addDays(start, 1)
  while (d <= end) {
    if (!isHoliday(data, d)) {
      const mine = slotsForDate(data, d).filter((s) => s.subjectId === subjectId)
      // exclude noclass/cancelled marks already made for this date
      const realClasses = mine.filter((s) => {
        const m = data.marks.find((mk) => mk.date === d && mk.slotId === s.id)
        return m?.status !== 'noclass' && m?.status !== 'cancelled'
      })
      if (realClasses.length > 0 && !usesTyped) {
        if (d > start) remainingClasses += realClasses.length
        held += realClasses.length
        const p = pct(attended, held)
        points.push({ date: d, held, attended, percent: p })
        if (p < threshold) {
          if (breachDate === null) breachDate = d
        } else {
          safeUntil = d // still safe skipping everything through this date
        }
      } else if (realClasses.length > 0 && usesTyped) {
        // J6: typed totals — future projections unreliable; keep flat line.
        remainingClasses += realClasses.length
        points.push({ date: d, held, attended, percent: pct(attended, held) })
      }
    }
    d = addDays(d, 1)
  }

  // Status vs threshold right now.
  let status: SubjectProjection['status']
  if (curPct < threshold) status = 'below'
  else {
    // B4-style limit check: zero headroom against ALL remaining? Use current skip maths.
    const canMissNow = Math.floor((100 * baseAttended - threshold * baseHeld) / threshold)
    status = canMissNow <= 0 ? 'limit' : 'safe'
  }

  // J9: how many of the REMAINING classes can be skipped and still finish ≥ threshold.
  // Skipping k of n remaining: final = attended / (held_total) where held_total = held + n.
  // attended unchanged → need attended/(held+n… wait skipping means NOT counting them as held?
  // College counts held classes regardless of attendance; skipping = absent, still held.
  // So attending none of the rest gives attended/(held+remaining). If that's ≥ t, can skip all.
  // Otherwise solve: attended + x ≥ t/100 × (held + remaining) is about attending, not skipping.
  // Skipped classes still count as held. canSkipRest = classes you can be ABSENT to
  // while ending ≥ threshold: attended/(held+remaining) ≥ t% ⇒ independent of which ones.
  // Headroom instead: number of remaining classes you could miss IF you attend the rest:
  // attended + (remaining − k) ≥ t/100 × (held + remaining)
  // `held` already includes the remaining classes after the walk.
  const required = (threshold / 100) * held
  const attendAll = attended + remainingClasses
  let canSkipRest = 0
  if (usesTyped) {
    canSkipRest = 0 // typed totals: don't project beyond them
  } else if (attendAll >= required) {
    canSkipRest = Math.max(0, Math.min(remainingClasses, Math.floor(attendAll - required)))
  }

  // J10: recovery count from current standing (B5 formula on current numbers).
  let mustAttendNext = 0
  if (curPct < threshold && threshold < 100) {
    mustAttendNext = Math.ceil((threshold * baseHeld - 100 * baseAttended) / (100 - threshold))
  }

  return {
    subjectId,
    shortName: subj.shortName,
    name: subj.fullName,
    threshold,
    current,
    currentPercent: curPct,
    status,
    points,
    breachDate,
    safeUntil,
    canSkipRest,
    mustAttendNext,
    remainingClasses,
    usesTypedTotals: usesTyped,
  }
}

/** Weeks (Mon-start) overlapping [from, to]. */
export function weeksIn(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  // find Monday of `from`
  const wd = weekdayOf(from) // 1..7 Mon..Sun
  let monday = addDays(from, -(wd - 1))
  while (monday <= to) {
    out.push(monday)
    monday = addDays(monday, 7)
  }
  return out
}

/** Weekly summary rows (J11) across all subjects combined. */
export function weeklySummary(
  data: AppData,
  from: DateStr,
  to: DateStr,
  today: DateStr,
): WeekRow[] {
  const rows: WeekRow[] = []
  for (const weekStart of weeksIn(from, to)) {
    const weekEnd = minStr(addDays(weekStart, 6), to)
    // Count only days within [from, min(weekEnd, today)] — future unknown.
    const cntFrom = maxStr(weekStart, from)
    const cntTo = minStr(weekEnd, today)
    if (cntFrom > cntTo) continue
    let held = 0
    let attended = 0
    for (const d of eachDay(cntFrom, cntTo)) {
      if (isHoliday(data, d)) continue
      for (const slot of slotsForDate(data, d)) {
        const m = data.marks.find((mk) => mk.date === d && mk.slotId === slot.id)
        if (m?.status === 'noclass' || m?.status === 'cancelled') continue
        held += 1
        if (m?.status === 'present') attended += 1
        else if (!m && d < today) attended += 0 // assumed handled below per-subject; weeks show exact only
      }
    }
    rows.push({ weekStart, held, attended, percent: pct(attended, held) })
  }
  return rows
}

/** Build the whole month plan. `month` is YYYY-MM (J2). Horizon ends at
 *  semester end or month end, whichever comes first. */
export function buildMonthPlan(data: AppData, month: string, today: DateStr): MonthPlan {
  const [y, m] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const semEnd = data.settings.semesterEnd ?? monthEnd
  const horizonEnd = minStr(monthEnd, semEnd)

  const subjects = data.subjects.map((s) =>
    projectSubject(data, s.id, maxStr(today, monthStart) > horizonEnd ? monthStart : maxStr(today, monthStart), horizonEnd),
  )

  let oh = 0
  let oa = 0
  for (const sp of subjects) {
    if (sp.status === 'nodata') continue
    oh += sp.current.held
    oa += sp.current.attended
  }

  return {
    monthKey: month,
    subjects,
    overallHeld: oh,
    overallAttended: oa,
    overallPercent: pct(oa, oh),
    weekly: weeklySummary(data, monthStart, horizonEnd, today),
  }
}

/** List of months from planStartMonth (or current month) to semester end month. */
export function planMonths(data: AppData, today: DateStr): string[] {
  const start = data.settings.planStartMonth ?? monthKey(today)
  const endMonth = data.settings.semesterEnd ? monthKey(data.settings.semesterEnd) : monthKey(today)
  const out: string[] = []
  let [y, m] = start.split('-').map(Number)
  let guard = 0
  while (guard++ < 24) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= endMonth) break
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function minStr(a: string, b: string): string {
  return a <= b ? a : b
}
function maxStr(a: string, b: string): string {
  return a >= b ? a : b
}
