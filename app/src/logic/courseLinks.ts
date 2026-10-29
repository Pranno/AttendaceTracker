// ============================================================
// Special courses (Section H) — pure helpers over CourseLink[].
// H1 overview ("WAD: 8 courses, 3 completed"), per-subject lists
// grouped by unit; H6 "N of M completed"; H8 deadline progress
// ("WAD certificates: 6 of 10 done"). Everything is derived from
// stored records — never stored itself. Works offline (H10).
// ============================================================

import type { CourseLink, Deadline, Subject } from '../data/model'

export interface CourseSubjectOverview {
  subjectId: string
  shortName: string
  total: number
  completed: number
  started: number
  notStarted: number
  /** H9/H4: entries with no usable link yet, or flagged "check link". */
  needsLink: number
}

/** H1: one row per subject that has at least one course link. */
export function courseOverview(subjects: Subject[], links: CourseLink[]): CourseSubjectOverview[] {
  const out: CourseSubjectOverview[] = []
  for (const s of subjects) {
    const mine = links.filter((c) => c.subjectId === s.id)
    if (mine.length === 0) continue
    out.push({
      subjectId: s.id,
      shortName: s.shortName,
      total: mine.length,
      completed: mine.filter((c) => c.status === 'completed').length,
      started: mine.filter((c) => c.status === 'started').length,
      notStarted: mine.filter((c) => c.status === 'not started').length,
      needsLink: mine.filter((c) => !c.url || c.needsChecking).length,
    })
  }
  return out
}

/** H1: group a subject's courses under their unit headings. Units sort by
 *  unitNumber when present, then alphabetically by title; courses keep the
 *  order they were added in. */
export function groupByUnit(links: CourseLink[]): { unit: string; courses: CourseLink[] }[] {
  const map = new Map<string, CourseLink[]>()
  for (const c of links) {
    const key = c.unitTitle ?? (c.unitNumber != null ? `Unit ${c.unitNumber}` : 'General')
    const arr = map.get(key)
    if (arr) arr.push(c)
    else map.set(key, [c])
  }
  const num = (u: string) => {
    const m = u.match(/(\d+)/)
    return m ? Number(m[1]) : Infinity
  }
  return [...map.entries()]
    .sort((a, b) => num(a[0]) - num(b[0]) || a[0].localeCompare(b[0]))
    .map(([unit, courses]) => ({ unit, courses }))
}

/** H8: progress line for a deadline linked to a list of courses,
 *  e.g. "6 of 10 done". Null when nothing is linked or all exist still. */
export function deadlineCourseProgress(
  dl: Deadline,
  links: CourseLink[],
): { done: number; total: number; label: string } | null {
  if (!dl.courseLinkIds || dl.courseLinkIds.length === 0) return null
  // Count only links that still exist (deleted ones are un-linked on delete).
  const mine = links.filter((c) => dl.courseLinkIds!.includes(c.id))
  if (mine.length === 0) return null
  const done = mine.filter((c) => c.status === 'completed').length
  return { done, total: mine.length, label: `${done} of ${mine.length} done` }
}

/** H2: normalise a pasted/typed address so Open always works (H3). */
export function normalizeUrl(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/** True when the text looks like a real http(s) link (used by import rules). */
export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []
}
