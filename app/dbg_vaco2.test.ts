import { describe, it } from 'vitest'
import { parseCellEntries } from './src/logic/timetableImport'

describe('dbg', () => {
  it('parseCellEntries on stacked line', () => {
    for (const line of [
      'A1 FE (P) PS 2408 A2 WAD (P) YP 2314 A3 CP (P) CK 2416',
      'A1 FE (P) PS 2408',
      'A1 CP (P) DTM A2 SDC (T) HK 2416',
    ]) {
      const es = parseCellEntries(line, line)
      console.log('IN:', line)
      for (const e of es) console.log('   ->', JSON.stringify({b: e.batch, s: e.subjectShort, t: e.teacher, r: e.room, rev: e.needsReview}))
    }
  })
})
