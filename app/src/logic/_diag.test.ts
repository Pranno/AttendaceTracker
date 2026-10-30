import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages, distinctBatches } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

it('diag', () => {
  const res = parseTimetablePages(fixtures as unknown as TextItemLike[][])
  console.log('TOTAL', res.entries.length, 'BATCHES', JSON.stringify(distinctBatches(res.entries)))
  for (const e of res.entries) {
    console.log('E>', [e.batch ?? '-', e.weekday, e.startTime + '-' + e.endTime, e.subjectShort, e.type, e.teacher || '-', e.room || '-', e.needsReview ? 'REVIEW' : ''].join(' | '))
  }
})
