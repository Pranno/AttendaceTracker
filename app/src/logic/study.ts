// Step-3 study logic: E5 marks, E6 deadlines, E7 exam countdown plan,
// E8 what-to-revise-next, E9 streak/stats helpers, E10 spaced repetition,
// E11 CGPA planner. Pure functions — no DOM, no storage — so they are unit-testable.

import type { AppData, CgpaSemester, DateStr, Deadline, Subject, Unit } from '../data/model'
import { addDays, diffDays, formatShort, todayStr } from './dates'

// ---------- E5. Marks & marking scheme ----------

export interface GradeBand { min: number; grade: string }
// "a rough guide", per the requirements doc
export const GRADE_GUIDE: GradeBand[] = [
  { min: 90, grade: 'O' }, { min: 80, grade: 'A+' }, { min: 70, grade: 'A' },
  { min: 60, grade: 'B+' }, { min: 50, grade: 'B' }, { min: 45, grade: 'C' },
  { min: 40, grade: 'P' }, { min: 0, grade: 'F' },
]

export function gradeFromPercent(pct: number): string {
  for (const b of GRADE_GUIDE) if (pct >= b.min) return b.grade
  return 'F'
}

export interface ComponentResult {
  componentId: string
  label: string
  weight: number
  fraction: number | null // null = no data yet
  contribution: number // weight × fraction
  counted: boolean // has data (score or attendance held>0)
}

export interface SubjectMarks {
  results: ComponentResult[]
  percent: number | null // sum(contribution)/sum(weight of counted) × 100
  marksGot: number
  marksOut: number
  showable: boolean // at least one NON-attendance score entered
}

/** fraction for a component: sum got ÷ sum out; best-N counts only the N best by percentage */
export function componentFraction(
  scores: { got: number; out: number }[],
  bestN?: number,
): number | null {
  const valid = scores.filter((s) => s.out > 0)
  if (valid.length === 0) return null
  let use = valid
  if (bestN && bestN > 0 && valid.length > bestN) {
    use = [...valid].sort((a, b) => b.got / b.out - a.got / a.out).slice(0, bestN)
  }
  const got = use.reduce((n, s) => n + s.got, 0)
  const out = use.reduce((n, s) => n + s.out, 0)
  return out > 0 ? got / out : null
}

/** Attendance fraction for the automatic attendance component: attended ÷ held. */
export function attendanceFraction(held: number, attended: number): number | null {
  return held > 0 ? attended / held : null
}

/**
 * E5: subject marks so far from its marking scheme.
 * scoresByComponent maps component id → list of {got, out}.
 * attHeld/attAttended come from the attendance core (B-series totals).
 */
export function subjectMarks(
  subject: Subject,
  scoresByComponent: Record<string, { got: number; out: number }[]>,
  attHeld: number,
  attAttended: number,
): SubjectMarks {
  const scheme = subject.markingScheme ?? []
  const results: ComponentResult[] = []
  for (const c of scheme) {
    let fraction: number | null = null
    let counted = false
    if (c.fromAttendance) {
      fraction = attendanceFraction(attHeld, attAttended)
      counted = fraction !== null
    } else {
      const list = scoresByComponent[c.id] ?? []
      fraction = componentFraction(list, c.bestN)
      counted = fraction !== null
    }
    results.push({
      componentId: c.id, label: c.label, weight: c.weight,
      fraction, contribution: counted && fraction !== null ? c.weight * fraction : 0, counted,
    })
  }
  const nonAttScores = scheme.some((c) => !c.fromAttendance && (scoresByComponent[c.id] ?? []).length > 0)
  const countedResults = results.filter((r) => r.counted)
  const wSum = countedResults.reduce((n, r) => n + r.weight, 0)
  const contrib = countedResults.reduce((n, r) => n + r.contribution, 0)
  const percent = wSum > 0 ? (contrib / wSum) * 100 : null
  let mGot = 0, mOut = 0
  for (const c of scheme) {
    if (c.fromAttendance) continue
    for (const s of scoresByComponent[c.id] ?? []) { mGot += s.got; mOut += s.out }
  }
  return { results, percent, marksGot: mGot, marksOut: mOut, showable: nonAttScores && percent !== null }
}

// ---------- E6. Deadlines in words ----------

/** "29 Oct, in 2 days" / "17–24 Oct, starts tomorrow" / "open now" / "last day today" / "date passed" (+ "(tentative)") */
export function describeDeadline(d: Deadline, today: DateStr = todayStr()): string {
  const start = d.startDate ?? d.dueDate
  const range = start === d.dueDate ? formatShort(start) : `${formatShort(start)}–${formatShort(d.dueDate)}`
  const startIn = diffDays(today, start)
  const endIn = diffDays(today, d.dueDate)
  let when: string
  if (endIn < 0) when = 'date passed'
  else if (startIn > 0) when = `starts ${describeIn(startIn)}`
  else if (endIn === 0) when = 'last day today'
  else when = 'open now'
  const base = `${range}, ${when}`
  return d.tentative ? `${base} (tentative)` : base
}

export function describeIn(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** E6: read covered units from the title: "unit 3", "units 1 and 2", "units 2 to 4". Returns 1-based indices. */
export function parseUnitsFromTitle(title: string): number[] {
  const t = title.toLowerCase()
  let m = t.match(/units?\s+(\d+)\s*(?:to|through|-|–)\s*(\d+)/)
  if (m) {
    const a = +m[1], b = +m[2]
    if (a <= b && b - a < 40) return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  }
  m = t.match(/\bunits\s+(\d+)\s+and\s+(\d+)\b/)
  if (m) return [+m[1], +m[2]]
  m = t.match(/\bunits?\s+(\d+)\b/)
  if (m) return [+m[1]]
  return []
}

/** Active (not done, not passed) deadlines within the next `weeks` weeks, nearest first. E6 "Coming up". */
export function upcomingDeadlines(data: AppData, weeks = 3, today: DateStr = todayStr()): Deadline[] {
  const horizon = addDays(today, weeks * 7)
  return data.deadlines
    .filter((d) => !d.done && d.dueDate >= today && d.dueDate <= horizon)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

function coveredUnitIds(d: Deadline, units: Unit[]): string[] {
  if (d.unitIds?.length) return d.unitIds
  return parseUnitsFromTitle(d.title).map((i) => units[i - 1]?.id).filter(Boolean) as string[]
}

function unitNumber(units: Unit[], id: string): number {
  return units.findIndex((u) => u.id === id) + 1
}

function dayLabel(s: DateStr): string {
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s + 'T00:00:00').getDay()]
  return `${wd} ${formatShort(s)}`
}

// ---------- E7. Exam countdown (revision plan) ----------

export interface PlanDay {
  date: DateStr
  label: string // e.g. "Mon 29 Oct"
  items: string[]
  isTestDay: boolean
}
export interface CountdownPlan {
  deadlineId: string
  title: string
  inDays: number
  days: PlanDay[] // up to 7 shown
}

/** Tests that cover units and start within 14 days → one plan per test. */
export function examPlans(data: AppData, today: DateStr = todayStr()): CountdownPlan[] {
  const unitsOf = (subjectId?: string) => data.units.filter((u) => u.subjectId === subjectId)
  const tests = data.deadlines
    .filter((d) => !d.done)
    .filter((d) => {
      const start = d.startDate ?? d.dueDate
      const inDays = diffDays(today, start)
      return inDays >= 0 && inDays <= 14 && coveredUnitIds(d, unitsOf(d.subjectId)).length > 0
    })
    .sort((a, b) => ((a.startDate ?? a.dueDate) < (b.startDate ?? b.dueDate) ? -1 : 1))

  const plans: CountdownPlan[] = []
  let prevEnd: DateStr | null = null
  for (const test of tests) {
    const units = unitsOf(test.subjectId)
    const covered = coveredUnitIds(test, units)
    const unrevised = units.filter((u) => covered.includes(u.id) && !u.revisedDate)
    const start = test.startDate ?? test.dueDate
    const inDays = diffDays(today, start)
    const windowStart = prevEnd && prevEnd >= today ? addDays(prevEnd, 1) : today
    const span: DateStr[] = []
    for (let d = windowStart; d <= start; d = addDays(d, 1)) span.push(d)
    const preDays = span.filter((d) => d !== start)
    const days: PlanDay[] = []
    let idx = 0
    preDays.forEach((dayDate, di) => {
      const items: string[] = []
      if (dayDate === today) {
        for (const u of units.filter((x) => covered.includes(x.id) && x.revisedDate === today))
          items.push(`Revise Unit ${unitNumber(units, u.id)}: ${u.title}`)
      }
      const remainingDays = preDays.length - di
      const remainingUnits = unrevised.length - idx
      const take = remainingUnits > 0 ? Math.ceil(remainingUnits / remainingDays) : 0
      for (let k = 0; k < take; k++) {
        const u = unrevised[idx++]
        items.push(`Revise Unit ${unitNumber(units, u.id)}: ${u.title}`)
      }
      if (items.length === 0) {
        if (di === preDays.length - 1 && preDays.length >= 2) {
          const missed = units.flatMap((u) => (u.questions ?? []).filter((q) => q.missedOnce))
          items.push(missed.length ? 'Last check: redo the questions you missed' : 'Last check: quick run through key formulas')
        } else {
          const u = units.find((x) => covered.includes(x.id))
          if (u) items.push(`Practise Unit ${unitNumber(units, u.id)} questions`)
        }
      }
      days.push({ date: dayDate, label: dayLabel(dayDate), items, isTestDay: false })
    })
    days.push({ date: start, label: dayLabel(start), items: [test.title], isTestDay: true })
    plans.push({ deadlineId: test.id, title: test.title, inDays, days: days.slice(0, 7) })
    prevEnd = test.dueDate
  }
  return plans
}

// ---------- E8. What to revise next ----------

export interface ReviseSuggestion {
  unitId: string
  subjectId: string
  subjectShort: string
  unitTitle: string
  reason: string
  action: 'revise' | 'redo' | 'refresh'
}

export type NextRevision = ReviseSuggestion | 'all-done' | 'no-units'

export function nextToRevise(
  data: AppData,
  todaySubjects: string[], // subject short names on today's timetable
  today: DateStr = todayStr(),
): NextRevision {
  const allUnits = data.units
    .map((u) => ({ s: data.subjects.find((x) => x.id === u.subjectId), u }))
    .filter((x): x is { s: Subject; u: Unit } => !!x.s)
  if (allUnits.length === 0) return 'no-units'
  if (allUnits.every(({ u }) => u.revisedDate)) return 'all-done'

  // tests within 14 days, nearest first, covering units
  const tests = data.deadlines
    .filter((d) => !d.done)
    .map((d) => ({ d, start: d.startDate ?? d.dueDate, units: data.units.filter((u) => u.subjectId === d.subjectId) }))
    .filter(({ d, start, units }) => diffDays(today, start) >= 0 && diffDays(today, start) <= 14 && coveredUnitIds(d, units).length > 0)
    .sort((a, b) => (a.start < b.start ? -1 : 1))

  for (const { d: test, start, units } of tests) {
    const subj = data.subjects.find((s) => s.id === test.subjectId)
    if (!subj) continue
    const covered = coveredUnitIds(test, units)
    const inDays = diffDays(today, start)
    // a) an unrevised unit it covers
    const un = units.find((u) => covered.includes(u.id) && !u.revisedDate)
    if (un) return mk(subj, un, `Revise this for: ${test.title}, ${formatShort(start)}, ${describeIn(inDays)}.`, 'revise')
    // b) a unit with practice questions missed
    const redo = units.find((u) => covered.includes(u.id) && (u.questions ?? []).some((q) => q.missedOnce))
    if (redo) return mk(subj, redo, `You missed questions on this unit. Redo them for ${test.title}.`, 'redo')
    // c) test ≤ 4 days away → refresh a unit revised 7+ days ago
    if (inDays <= 4) {
      const stale = units.find((u) => covered.includes(u.id) && u.revisedDate && diffDays(u.revisedDate, today) >= 7)
      if (stale) return mk(subj, stale, `${test.title} is close — refresh this, it has been a week.`, 'refresh')
    }
  }

  // No test close: prefer subjects on today's timetable, then least-revised subject, then more credits
  const unrevised = allUnits.filter(({ u }) => !u.revisedDate)
  const onToday = unrevised.filter(({ s }) => todaySubjects.includes(s.shortName))
  const pool = onToday.length ? onToday : unrevised
  if (pool.length === 0) return 'all-done'
  const rate = (sid: string) => {
    const us = data.units.filter((u) => u.subjectId === sid)
    return us.length ? us.filter((u) => u.revisedDate).length / us.length : 1
  }
  const pick = [...pool].sort((a, b) => {
    const ra = rate(a.s.id), rb = rate(b.s.id)
    if (ra !== rb) return ra - rb
    return (b.s.credits ?? 0) - (a.s.credits ?? 0)
  })[0]
  const reason = onToday.length
    ? `${pick.s.shortName} is on today's timetable, so go over it while it's fresh.`
    : `No test close — ${pick.s.shortName} is your least-revised subject.`
  return mk(pick.s, pick.u, reason, 'revise')
}

function mk(s: Subject, u: Unit, reason: string, action: ReviseSuggestion['action']): ReviseSuggestion {
  return { unitId: u.id, subjectId: s.id, subjectShort: s.shortName, unitTitle: u.title, reason, action }
}

// ---------- E9. Streak ----------

/** Days in a row with any study activity (focus session, unit ticked, topic ticked, question answered).
 *  Today counts even if empty — caller says "Study today to keep it going." */
export function studyStreak(activityDates: Set<DateStr>, today: DateStr = todayStr()): { count: number; todayActive: boolean } {
  const todayActive = activityDates.has(today)
  let cursor = todayActive ? today : addDays(today, -1)
  let count = 0
  while (activityDates.has(cursor)) { count++; cursor = addDays(cursor, -1) }
  return { count, todayActive }
}

export function collectActivityDates(data: AppData): Set<DateStr> {
  const set = new Set<DateStr>()
  for (const f of data.focusSessions) set.add(f.date)
  for (const u of data.units) {
    if (u.revisedDate) set.add(u.revisedDate)
    for (const t of u.topics) if (t.revisedDate) set.add(t.revisedDate)
    for (const q of u.questions ?? []) if (q.lastAnswerOn) set.add(q.lastAnswerOn)
  }
  return set
}

// ---------- E10. Practice questions / spaced repetition ----------

export const BOX_INTERVALS = [0, 1, 3, 7, 14] // days until due, box 0..4

export interface QuestionState {
  id: string
  box: number
  dueOn: DateStr | null
  missedOnce?: boolean
}

export function answerQuestion<T extends QuestionState>(q: T, gotIt: boolean, today: DateStr = todayStr()): T {
  const box = gotIt ? Math.min(4, q.box + 1) : 0
  return { ...q, box, dueOn: addDays(today, BOX_INTERVALS[box]), missedOnce: !gotIt }
}

/** Session order: previously-missed first, then due reviews (least known first), then new in order;
 *  if nothing due → least-known. Max 10. */
export function pickSession<T extends QuestionState>(questions: T[], today: DateStr = todayStr()): T[] {
  const missedFirst = questions.filter((q) => q.missedOnce)
  const due = questions
    .filter((q) => !q.missedOnce && q.dueOn !== null && q.dueOn <= today)
    .sort((a, b) => a.box - b.box) // least known first
  const fresh = questions.filter((q) => !q.missedOnce && q.dueOn === null)
  let pool = [...missedFirst, ...due, ...fresh]
  if (pool.length === 0) pool = [...questions].sort((a, b) => a.box - b.box)
  return pool.slice(0, 10)
}

/** Due-now count for the unit button "Practise questions (N to redo)". */
export function dueCount(questions: QuestionState[], today: DateStr = todayStr()): number {
  return questions.filter((q) => q.missedOnce || (q.dueOn !== null && q.dueOn <= today)).length
}

// ---------- E11. CGPA planner ----------

export const GRADE_POINTS: Record<string, number> = { O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, P: 4, F: 0 }

export function sgpaOf(sem: CgpaSemester): { sgpa: number; credits: number; points: number } | null {
  if (sem.mode === 'sgpa') {
    if (sem.sgpa === undefined || !sem.credits || sem.credits <= 0) return null
    return { sgpa: sem.sgpa, credits: sem.credits, points: round2(sem.sgpa * sem.credits) }
  }
  const subs = (sem.subjects ?? []).filter((s) => s.credits > 0 && GRADE_POINTS[s.grade] !== undefined)
  if (!subs.length) return null
  const credits = subs.reduce((n, s) => n + s.credits, 0)
  const points = subs.reduce((n, s) => n + s.credits * GRADE_POINTS[s.grade], 0)
  return { sgpa: round2(points / credits), credits, points }
}

export function cgpaOf(semesters: CgpaSemester[]): { cgpa: number; sems: number; credits: number } | null {
  let pts = 0, cr = 0, sems = 0
  for (const s of semesters) {
    const r = sgpaOf(s)
    if (r) { pts += r.points; cr += r.credits; sems++ }
  }
  if (cr === 0) return null
  return { cgpa: round2(pts / cr), sems, credits: cr }
}

/** Needed SGPA for target — rounded UP to 2 decimals. Includes the special messages. */
export function neededSgpa(
  semesters: CgpaSemester[],
  target: number,
  nextCredits: number,
): { needed: number | null; message: string } {
  const cur = cgpaOf(semesters)
  const ptsSoFar = cur ? cur.cgpa * cur.credits : 0
  const crSoFar = cur ? cur.credits : 0
  if (!(nextCredits > 0)) return { needed: null, message: 'Enter next semester credits.' }
  const raw = (target * (crSoFar + nextCredits) - ptsSoFar) / nextCredits
  if (raw > 10) {
    const perfect = round2((ptsSoFar + 10 * nextCredits) / (crSoFar + nextCredits))
    return { needed: null, message: `Not reachable in one semester. Even a perfect 10 takes you to ${perfect}.` }
  }
  if (raw <= 0) {
    const safe = cur ? cur.cgpa : target
    return { needed: 0, message: `You're already safe. Any SGPA keeps you at ${safe.toFixed(2)} or above.` }
  }
  const needed = Math.ceil(raw * 100) / 100
  return { needed, message: `You need an SGPA of about ${needed.toFixed(2)} next semester.` }
}

/** Estimate SGPA from marks-so-far percentages via the grade guide (for ungraded subjects). */
export function estimateSgpaFromMarks(entries: { credits: number; percent: number | null }[]): number | null {
  const usable = entries.filter((e) => e.percent !== null && e.credits > 0)
  if (!usable.length) return null
  const pts = usable.reduce((n, e) => n + e.credits * GRADE_POINTS[gradeFromPercent(e.percent as number)], 0)
  const cr = usable.reduce((n, e) => n + e.credits, 0)
  return round2(pts / cr)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
