import { describe, it } from 'vitest'
import { stitchCellFrags, parseCellEntries } from './src/logic/timetableImport'
describe('dbg', () => {
  it('runs', () => {
    const mk = (str: string, x: number, y: number) => ({ str, x, end: x + str.length * 5, y, page: 0 })
    const frags: any[] = [
      mk('A', 587.7, 285.5), mk('VACO-I', 599.3, 285.5), mk('(L)', 642.8, 285.5),
      mk('JK', 602.7, 271.7), mk('2403', 619.0, 271.7),
    ]
    console.log('STITCHED', JSON.stringify(stitchCellFrags(frags)))
    for (const ln of stitchCellFrags(frags)) console.log('CELL', JSON.stringify(parseCellEntries(ln, 'raw')))
  })
})
