import { describe, it } from 'vitest'
import fixtures from '../logic/__fixtures__/timetable-divA.json'
import { parseTimetablePages } from '../logic/timetableImport'
import type { TextItemLike } from '../logic/syllabusReader'
describe('dbg', () => {
  it('dump divA sample', () => {
    const res = parseTimetablePages(fixtures as unknown as TextItemLike[][])
    console.log('count', res.entries.length, 'batches', JSON.stringify(res.entries.filter(e=>e.batch).map(e=>e.batch)))
    for (const e of res.entries) console.log(`${e.weekday} ${e.startTime}-${e.endTime} b=${e.batch ?? '-'} s=${e.subjectShort} rev=${e.needsReview} raw="${e.raw}"`)
  })
})
