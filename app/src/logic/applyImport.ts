// Turn reviewed timetable entries into saved subjects + weekly classes.
// Pure (no React) so the whole PDF → parser → save → Today/Calendar chain
// can be tested end to end.

import type { AppData, DateStr, Slot, Subject } from '../data/model'
import { newId } from '../data/model'
import { timetableStartOf } from './timetableStart'
import { entriesToSlots, type ParsedEntry } from './timetableImport'

/** An entry the importer could not read fully (no day/time, or flagged). */
export const isProblemEntry = (e: ParsedEntry) => e.needsReview || !e.weekday || !e.startTime

export interface ImportOutcome {
  subjects: Subject[]
  /** classes to add (already given ids) */
  newSlots: Slot[]
  /** entries that could not be saved — shown to the user */
  notSaved: ParsedEntry[]
  /** classes skipped because the timetable already has exactly that class */
  alreadyThere: number
}

export function applyImport(
  data: AppData,
  parsed: ParsedEntry[],
  legend: { short: string; full: string }[],
  today: DateStr,
): ImportOutcome {
  const subjects = [...data.subjects]
  const byShort = new Map(subjects.map((s) => [s.shortName.toUpperCase(), s.id]))
  // Legend full names from the PDF; grid cells print "VACO-I" while the legend key is "VACO".
  const legendMap = new Map(legend.map((l) => [l.short.toUpperCase(), l.full]))
  const fullOf = (k: string) => legendMap.get(k) ?? legendMap.get(k.replace(/-[IVX]+$/, ''))
  for (const e of parsed) {
    if (isProblemEntry(e)) continue // unreadable cells must not create junk subjects
    const key = e.subjectShort.toUpperCase()
    if (!byShort.has(key)) {
      const subj: Subject = { id: newId('subj'), shortName: key, fullName: fullOf(key) ?? key, nicknames: [] }
      subjects.push(subj)
      byShort.set(key, subj.id)
    } else if (fullOf(key)) {
      const i = subjects.findIndex((s) => s.id === byShort.get(key))
      if (i >= 0 && subjects[i].fullName === subjects[i].shortName) subjects[i] = { ...subjects[i], fullName: fullOf(key)! }
    }
  }
  const good = parsed.filter((e) => !isProblemEntry(e))
  // Imported classes belong to the whole timetable, like hand-added ones:
  // they start at the semester start (or the earliest class), not on the import day.
  const { slots, unmatched } = entriesToSlots(good, byShort, timetableStartOf(data, today))
  // Importing the same timetable twice used to add every class a second time
  // (each showed twice and was counted twice). Skip classes the timetable
  // already has, and identical rows inside this import.
  const sameClass = (a: Omit<Slot, 'id'>, b: Omit<Slot, 'id'>) =>
    a.subjectId === b.subjectId && a.weekday === b.weekday && a.startTime === b.startTime &&
    a.endTime === b.endTime && a.type === b.type && (a.batch ?? '') === (b.batch ?? '')
  const active = data.slots.filter((s) => s.validUntil === null || s.validUntil >= today)
  const newSlots: Slot[] = []
  let alreadyThere = 0
  for (const s of slots) {
    if (active.some((x) => sameClass(x, s)) || newSlots.some((x) => sameClass(x, s))) {
      alreadyThere += 1
      continue
    }
    newSlots.push({ ...s, id: newId('slot') })
  }
  return { subjects, newSlots, notSaved: [...parsed.filter(isProblemEntry), ...unmatched], alreadyThere }
}
