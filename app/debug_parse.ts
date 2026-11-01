import fs from 'fs'
import { parseTimetablePages } from './src/logic/timetableImport'
import type { TextItemLike } from './src/logic/syllabusReader'

const files = process.argv.slice(2)
for (const file of files) {
  const fixtures = JSON.parse(fs.readFileSync(file, 'utf8')) as TextItemLike[][]
  const res = parseTimetablePages(fixtures)
  console.log('='.repeat(10), file, '| entries:', res.entries.length, '| batches:', res.batches.join(','), '| warnings:', JSON.stringify(res.warnings))
  const byDay = new Map<number, typeof res.entries>()
  for (const e of res.entries) { if (!byDay.has(e.weekday)) byDay.set(e.weekday, []); byDay.get(e.weekday)!.push(e) }
  const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (const [d, list] of [...byDay.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log(days[d])
    for (const e of list.sort((a,b)=>a.startTime.localeCompare(b.startTime)))
      console.log(`   ${e.startTime}-${e.endTime} ${e.batch ?? '-'} ${e.subjectShort}(${e.type}) ${e.teacher} ${e.room}${e.needsReview ? ' ?REVIEW: ' + e.note : ''}`)
  }
}
