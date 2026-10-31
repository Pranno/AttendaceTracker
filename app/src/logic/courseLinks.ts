// ============================================================
// Course-link helpers — the small part of "Special courses" (Section H)
// that the Calendar still uses: progress text on a deadline
// ("WAD certificates: 6 of 10 done") and URL normalization.
// The full Special-courses screen was removed; see docs/PROGRESS.md.
// ============================================================

import type { CourseLink, Deadline } from '../data/model'

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

/** Ensure a pasted/typed link has a scheme so it opens in a browser. */
export function normalizeUrl(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}
