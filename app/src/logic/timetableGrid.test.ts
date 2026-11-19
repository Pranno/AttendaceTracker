// Regression tests for the timetable grid reader against the real Div-A
// timetable, extracted two ways: one pdf.js item per WORD
// (timetable-divA.json) and one item per text RUN (tt-divA.json). Both must
// read the printed grid exactly — every period, batch, teacher and room.
import { describe, expect, it } from 'vitest'
import wordLevel from './__fixtures__/timetable-divA.json'
import runLevel from './__fixtures__/tt-divA.json'
import divC from './__fixtures__/tt-divC.json'
import divF from './__fixtures__/tt-divF.json'
import { collegeHour, parseCellEntries, parseTimeRange, parseTimetablePages, type ParsedEntry } from './timetableImport'
import type { TextItemLike } from './pdfText'

const fmt = (e: ParsedEntry) =>
  `${e.weekday} ${e.startTime}-${e.endTime} ${e.batch ?? '-'} ${e.subjectShort}(${e.type}) ${e.teacher}/${e.room}`

/** Div A as printed (weekday 1=Mon … 6=Sat). */
const DIV_A = [
  '1 08:00-09:00 A1 FE(lab) PS/2408',
  '1 08:00-09:00 A2 WAD(lab) YP/2314',
  '1 08:00-09:00 A3 CP(lab) CK/2416',
  '1 09:00-10:00 A1 FE(lab) PS/2408',
  '1 09:00-10:00 A2 WAD(lab) YP/2314',
  '1 09:00-10:00 A3 CP(lab) CK/2416',
  '1 10:15-11:15 - IKS(lecture) PS/2406',
  '1 11:15-12:15 - WAD(lecture) YP/2406',
  '1 12:15-13:15 - ASEP(lab) /',
  '1 13:15-14:15 - ASEP(lab) /',
  '2 08:00-09:00 - FE(lecture) PS/2406',
  '2 09:00-10:00 - SDC(lecture) ST/2406',
  '2 10:15-11:15 A1 CP(lab) DTM/2416',
  '2 10:15-11:15 A2 FE(lab) PS/2408',
  '2 10:15-11:15 A3 WAD(lab) BK/2314',
  '2 11:15-12:15 A1 CP(lab) DTM/2416',
  '2 11:15-12:15 A2 FE(lab) PS/2408',
  '2 11:15-12:15 A3 WAD(lab) BK/2314',
  '2 13:15-14:15 - CP(lecture) KRP/2407',
  '3 08:00-09:00 A3 SDC(tutorial) ST/2407',
  '3 09:00-10:00 - CP(lecture) KRP/2407',
  '3 10:15-11:15 - CP(lecture) KRP/2407',
  '3 12:15-13:15 A1 WAD(lab) YP/2314',
  '3 12:15-13:15 A2 CP(lab) KRP/2416',
  '3 13:15-14:15 A1 WAD(lab) YP/2314',
  '3 13:15-14:15 A2 CP(lab) KRP/2416',
  '4 08:00-09:00 - SDC(lecture) ST/2403',
  '4 09:00-10:00 - FE(lecture) PS/2403',
  '4 10:15-11:15 A1 SDC(tutorial) HK/2403',
  '4 10:15-11:15 A3 FE(lab) NS/2408',
  '4 11:15-12:15 A2 SDC(tutorial) JSA/2403',
  '4 11:15-12:15 A3 FE(lab) NS/2408',
  '5 08:00-09:00 - SDC(lecture) ST/2403',
  '5 09:00-10:00 - VACO-I(lecture) JK/2403',
  '5 10:15-11:15 - FE(lecture) PS/2403',
  '5 12:15-13:15 - ASEP(lab) /',
  '5 13:15-14:15 - ASEP(lab) /',
  '6 14:15-15:15 - ASEP(lab) /',
]

describe('Div-A grid read exactly', () => {
  for (const [name, pages] of [['word-level items', wordLevel], ['run-level items', runLevel]] as const) {
    it(name, () => {
      const res = parseTimetablePages(pages as unknown as TextItemLike[][])
      expect(res.entries.map(fmt).sort()).toEqual([...DIV_A].sort())
      expect(res.entries.filter((e) => e.needsReview)).toHaveLength(0)
      expect(res.batches).toEqual(expect.arrayContaining(['A1', 'A2', 'A3']))
      const names = Object.fromEntries(res.subjects.map((s) => [s.short, s.full]))
      expect(names.CP).toBe('Computer Programming')
      expect(names.SDC).toBe('Statistics and Differential Calculus')
      // teacher initials / break words are never offered as subjects
      for (const bogus of ['KRP', 'DTM', 'LUNCH', 'BREAK']) expect(names[bogus]).toBeUndefined()
    })
  }
})

describe('other divisions', () => {
  it('afternoon periods are stored in 24-hour time and nothing needs review', () => {
    for (const pages of [divC, divF]) {
      const res = parseTimetablePages(pages as unknown as TextItemLike[][])
      expect(res.entries.length).toBeGreaterThan(25)
      for (const e of res.entries) expect(e.startTime >= '08:00' && e.endTime <= '18:30').toBe(true)
      expect(res.entries.filter((e) => e.needsReview)).toHaveLength(0)
      // no class is emitted twice for the same batch and period
      const keys = res.entries.map((e) => `${e.weekday}|${e.startTime}|${e.batch ?? ''}|${e.subjectShort}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('reads the legend on a larger page (Div F)', () => {
    const res = parseTimetablePages(divF as unknown as TextItemLike[][])
    const names = Object.fromEntries(res.subjects.map((s) => [s.short, s.full]))
    expect(names.CP).toBe('Computer Programming')
    expect(names.WAD).toBe('Web Application Development')
  })
})

describe('cell / time helpers', () => {
  it('12-hour afternoon labels become 24-hour times', () => {
    expect(parseTimeRange('1.15 - 2.15')).toEqual(['13:15', '14:15'])
    expect(parseTimeRange('12.15 - 1.15')).toEqual(['12:15', '13:15'])
    expect(collegeHour(8)).toBe(8)
    expect(collegeHour(5)).toBe(17)
  })

  it('keeps hyphenated and glued codes whole', () => {
    expect(parseCellEntries('A VACO-I (L) JK 2403', '').map((e) => e.subjectShort)).toEqual(['VACO-I'])
    expect(parseCellEntries('ASEP(P)', '').map((e) => e.subjectShort)).toEqual(['ASEP'])
    expect(parseCellEntries('F SDC(L) JSA', '').map((e) => e.subjectShort)).toEqual(['SDC'])
  })
})
