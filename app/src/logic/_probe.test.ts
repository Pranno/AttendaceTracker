import { describe, it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

describe('probe', () => {
  it('dump', () => {
    const res = parseTimetablePages(fixtures as unknown as TextItemLike[][])
    console.log('entries:', res.entries.length)
    for (const e of res.entries) console.log(JSON.stringify({d:e.weekday,t:e.startTime,b:e.batch,s:e.subjectShort,te:e.teacher,r:e.room,rev:e.needsReview}))
    console.log('batches:', res.batches)
  })
})
