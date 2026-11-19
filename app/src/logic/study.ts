// Marks (E5) and CGPA planner (E11) maths used by the CGPA planner on the
// Subjects tab. Pure functions — no DOM, no storage — so they are unit-testable.
// (The old Study-tab helpers — units, revision plans, practice questions —
// were removed together with that tab.)

import type { CgpaSemester, Subject } from '../data/model'

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
  // Exact grade points, not the 2-dp-rounded CGPA × credits (that drifted the answer).
  let ptsSoFar = 0
  let crSoFar = 0
  for (const sem of semesters) {
    const r = sgpaOf(sem)
    if (r) { ptsSoFar += r.points; crSoFar += r.credits }
  }
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
  // epsilon: 8.5 computed as 8.5000000001 must not become 8.51
  const needed = Math.ceil(raw * 100 - 1e-9) / 100
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
