import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { groupItemsIntoLines, type TextItemLike } from './syllabusReader'
import { findDayColumns, stitchCellFrags, parseCellEntries, type Frag } from './timetableImport'

it('dbg', () => {
  const pg = fixtures[0] as unknown as TextItemLike[]
  const frags: Frag[] = []
  for (const ln of groupItemsIntoLines(pg, 0)) {
    for (const itx of ln.items) {
      const s = itx.str.trim()
      if (!s) continue
      frags.push({ x: itx.x, end: itx.end, y: (itx.rawY ?? itx.y) as number, str: s, page: 0 })
    }
  }
  const cols = findDayColumns(frags)
  console.log('COLS>', JSON.stringify(cols))
  const lo = cols[0].x - 30, hi = (cols[0].x + cols[1].x) / 2
  const box = frags.filter(f => f.y <= 353 && f.y > 250 && ((Math.min(f.end, hi) - Math.max(f.x, lo)) / Math.max(1, f.end - f.x)) >= 0.5)
  console.log('BOX>', JSON.stringify(box.map(b => b.str)))
  const lines = stitchCellFrags(box)
  console.log('LINES>', JSON.stringify(lines))
  for (const l of lines) console.log('PARSED>', JSON.stringify(parseCellEntries(l, l).map(e => e.batch + '|' + e.subjectShort)))
})
