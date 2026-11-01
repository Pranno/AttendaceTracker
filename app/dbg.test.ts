import { it } from 'vitest'
import divF from './src/logic/__fixtures__/tt-divF.json'
import { parseTimetablePages, findDayColumns } from './src/logic/timetableImport'
import type { TextItemLike } from './src/logic/syllabusReader'

it('dbg', () => {
  const pages = divF as unknown as TextItemLike[][]
  const res = parseTimetablePages(pages)
  console.log('ENTRIES', res.entries.length)
  for (const e of res.entries) console.log(`d${e.weekday} ${e.startTime}-${e.endTime} b=${e.batch ?? '-'} s=${e.subjectShort} t=${e.teacher} r=${e.room} rev=${e.needsReview} raw="${e.raw}"`)
  console.log('cols p0', JSON.stringify(findDayColumns(pages[0].map((it2,i)=>({x:it2.transform[4],end:it2.transform[4]+it2.width,y:it2.transform[5],str:it2.str,page:0})) as any)))
})
