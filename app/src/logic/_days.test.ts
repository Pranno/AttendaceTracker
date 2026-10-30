import fs from 'node:fs'
import { it } from 'vitest'
import { parseTimetablePages } from './timetableImport'

it('dump days', () => {
  const fixture = JSON.parse(fs.readFileSync('./src/logic/__fixtures__/timetable-divA.json', 'utf8'))
  const res = parseTimetablePages(fixture as any)
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const byDay: Record<string, number> = {}
  for (const e of res.entries) byDay[names[e.weekday]] = (byDay[names[e.weekday]] ?? 0) + 1
  console.log('total:', res.entries.length, JSON.stringify(byDay))
  console.log('warnings:', JSON.stringify(res.warnings))
  for (const e of res.entries) console.log(names[e.weekday], e.startTime, e.endTime, e.batch ?? "-", e.subjectShort, e.type, e.teacher || "-", e.room ?? "-", e.needsReview ? "REVIEW" : "")
})
