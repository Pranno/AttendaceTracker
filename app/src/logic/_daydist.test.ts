import { describe, it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages, type ParsedEntry } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

const DAYS = ['?', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

describe('day distribution', () => {
  it('dump', () => {
    const res = parseTimetablePages(fixtures as unknown as TextItemLike[][])
    const byDay: Record<string, number> = {}
    for (const e of res.entries) byDay[DAYS[e.weekday] || String(e.weekday)] = (byDay[DAYS[e.weekday]] || 0) + 1
    console.log('TOTAL', res.entries.length, JSON.stringify(byDay))
    for (const e of res.entries) console.log(DAYS[e.weekday], e.startTime, e.subjectCode ?? '?', e.room ?? '', e.needsReview ? 'REVIEW' : '')
  })
})
