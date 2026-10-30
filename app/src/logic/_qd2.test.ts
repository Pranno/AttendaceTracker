import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

it('day distribution', () => {
  const pages = fixtures as unknown as TextItemLike[][]
  const res = parseTimetablePages(pages)
  const days = ['?', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const perDay: Record<number, string[]> = {}
  for (const e of res.entries) {
    ;(perDay[e.weekday] ||= []).push(`${e.startTime} ${e.subjectShort}${e.batch || ''}`)
  }
  console.log('TOTAL', res.entries.length)
  for (const d of Object.keys(perDay).map(Number).sort()) {
    console.log(days[d], perDay[d].length, '|', perDay[d].sort().join(', '))
  }
  console.log('WARNINGS', JSON.stringify(res.warnings))
})
