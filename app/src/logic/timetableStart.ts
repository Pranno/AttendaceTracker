import type { AppData, DateStr } from '../data/model'

/** First day the timetable applies: the semester start, else the earliest
 *  class's start, else `fallback` — whichever is earliest. Used for classes
 *  that belong to the whole timetable (hand-added and imported alike). */
export function timetableStartOf(d: Pick<AppData, 'settings' | 'slots'>, fallback: DateStr): DateStr {
  const floor = d.settings.semesterStart
    ?? (d.slots.length ? d.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), fallback) : fallback)
  return fallback > floor ? floor : fallback
}
