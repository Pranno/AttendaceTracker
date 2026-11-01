import { it, expect } from 'vitest'
import fs from 'fs'
import type { TextItemLike } from './src/logic/syllabusReader'
// @ts-ignore - internal module
import { findDayColumns, readGridBoxes } from './src/logic/timetableImport'

it('probe grid', () => {
  const pages = JSON.parse(fs.readFileSync('./src/logic/__fixtures__/tt-divF.json', 'utf8')) as TextItemLike[][]
  pages.forEach((pg, pi) => {
    const frags = pg.map(i => ({ x: i.transform[4], end: i.transform[4] + (i.width ?? 0), y: i.transform[5], str: i.str.trim(), page: pi })).filter(f => f.str)
    const cols = findDayColumns(frags)
    console.log(`page ${pi}: dayCols=${JSON.stringify(cols.map(c=>c.weekday+'@'+Math.round(c.x)))}`)
    if (cols.length >= 4) {
      const w: string[] = []
      const es = readGridBoxes(frags, cols, w)
      console.log(`  -> ${es.length} raw entries`)
      for (const e of es) console.log(`   ${e.weekday} ${e.startTime}-${e.endTime} b=${e.batch} s=${e.subjectShort} rev=${e.needsReview} raw="${e.raw}"`)
    }
  })
  expect(true).toBe(true)
})
