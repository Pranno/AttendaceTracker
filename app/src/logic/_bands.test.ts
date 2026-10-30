import fs from 'node:fs'
import { it } from 'vitest'
import { readGridBoxes, findDayColumns, type Frag } from './timetableImport'

it('dump bands', () => {
  const fixture = JSON.parse(fs.readFileSync('./src/logic/__fixtures__/timetable-divA.json', 'utf8'))
  const pageFrags: Frag[][] = []
  fixture.forEach((items: any[], pgIndex: number) => {
    const frags: Frag[] = []
    for (const itx of items) {
      const s = (itx.str ?? '')
      if (!s.trim()) continue
      const tr = itx.transform ?? []
      frags.push({ x: tr[4], end: tr[4] + (itx.width ?? 0), y: tr[5], str: s, page: pgIndex })
    }
    pageFrags.push(frags)
  })
  const cols = findDayColumns(pageFrags[0])
  console.log('COLS:', JSON.stringify(cols))
  const warnings: string[] = []
  const entries = readGridBoxes(pageFrags[1], cols, warnings)
  console.log('PAGE1 ENTRIES:', entries.length)
  for (const e of entries) console.log(e.weekday, e.startTime, e.endTime, e.batch ?? '-', e.subjectShort, e.type, e.teacher || '-', e.room ?? '-', e.needsReview ? 'REVIEW' : '', '| raw=', e.raw.slice(0, 90))
})
