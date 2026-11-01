import fs from 'fs'
import { parseTimetablePages, filterByBatch } from './src/logic/timetableImport'
import type { TextItemLike } from './src/logic/syllabusReader'

const fixtures = JSON.parse(fs.readFileSync('src/logic/__fixtures__/timetable-divA.json', 'utf8')) as TextItemLike[][]
const res = parseTimetablePages(fixtures)
console.log('entries:', res.entries.length, 'warnings:', res.warnings)
const map = new Map<string, typeof res.entries>()
for (const e of res.entries) {
  const k = `${e.weekday} ${e.startTime}-${e.endTime}`
  if (!map.has(k)) map.set(k, [])
  map.get(k)!.push(e)
}
const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
for (const [k, list] of [...map.entries()].sort()) {
  console.log(days[Number(k.split(' ')[0])] ?? k, '|', list.map(e => `${e.batch ?? '-'} ${e.subjectShort}(${e.type}) ${e.teacher} ${e.room}${e.needsReview ? ' ?REVIEW' : ''}`).join(' || '))
}
console.log('--- A1 filtered:', filterByBatch(res.entries, 'A1').length)
