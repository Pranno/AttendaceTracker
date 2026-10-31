import { describe, it, expect } from 'vitest'
import { parseBatchTag, slotMatchesBatch } from '../data/model'
import { parseTimeRange, weekdayFromName, typeFromLetter, parseCellEntries, parseCsvLine, filterByBatch, parseTimetableText } from './timetableImport'

describe('batch rules', () => {
  it('parses tags', () => {
    expect(parseBatchTag('A1')).toEqual({ div: 'A', num: 1 })
    expect(parseBatchTag('A')).toEqual({ div: 'A', num: null })
    expect(parseBatchTag('')).toBeNull()
    expect(parseBatchTag(undefined)).toBeNull()
  })
  it('untagged slot belongs to everyone', () => {
    expect(slotMatchesBatch(undefined, 'A2')).toBe(true)
    expect(slotMatchesBatch('', 'A2')).toBe(true)
  })
  it('same batch matches, other batch of same division does not', () => {
    expect(slotMatchesBatch('A2', 'A2')).toBe(true)
    expect(slotMatchesBatch('A3', 'A2')).toBe(false)
    expect(slotMatchesBatch('B1', 'A2')).toBe(false)
  })
  it('division-only selection sees all batches of that division', () => {
    expect(slotMatchesBatch('A3', 'A')).toBe(true)
    expect(slotMatchesBatch('B1', 'A')).toBe(false)
  })
  it('no batch set shows everything', () => {
    expect(slotMatchesBatch('B2', '')).toBe(true)
  })
})

describe('cell parsing', () => {
  it('reads time ranges with dots and dashes', () => {
    expect(parseTimeRange('8:00 - 9:00')).toEqual(['08:00', '09:00'])
    expect(parseTimeRange('11.15 – 12.15')).toEqual(['11:15', '12:15'])
    expect(parseTimeRange('LUNCH BREAK')).toBeNull()
  })
  it('maps day names', () => {
    expect(weekdayFromName('Monday')).toBe(1)
    expect(weekdayFromName('Saturday')).toBe(6)
    expect(weekdayFromName('Time')).toBeNull()
  })
  it('maps course letters (college note)', () => {
    expect(typeFromLetter('L')).toBe('lecture')
    expect(typeFromLetter('P')).toBe('lab')
    expect(typeFromLetter('T')).toBe('tutorial')
  })
  it('parses a stacked multi-batch cell like the real PDF', () => {
    const cell = 'A1 FE (P) PS 2408 A2 WAD (P) YP 2314 A3 CP (P) CK 2416'
    const es = parseCellEntries(cell, cell)
    expect(es.length).toBe(3)
    expect(es[0]).toMatchObject({ batch: 'A1', subjectShort: 'FE', type: 'lab', teacher: 'PS', room: '2408' })
    expect(es[1]).toMatchObject({ batch: 'A2', subjectShort: 'WAD' })
    expect(es[2]).toMatchObject({ batch: 'A3', subjectShort: 'CP' })
  })
  it('parses whole-class entry without batch tag', () => {
    const es = parseCellEntries('A SDC (L) ST 2403', 'x')
    expect(es[0]).toMatchObject({ batch: undefined, subjectShort: 'SDC', type: 'lecture', teacher: 'ST', room: '2403' })
  })
  it('parses CSV row', () => {
    const e = parseCsvLine('Monday,08:00,09:00,A1,FE,P,PS,2408')
    expect(e).toMatchObject({ batch: 'A1', subjectShort: 'FE', type: 'lab', weekday: 1, startTime: '08:00', endTime: '09:00' })
  })
  it('filterByBatch keeps mine + untagged', () => {
    const all = [
      { raw: '', subjectShort: 'FE', type: 'lab' as const, teacher: '', room: '', weekday: 1, startTime: '08:00', endTime: '09:00', needsReview: false, batch: 'A1' },
      { raw: '', subjectShort: 'WAD', type: 'lab' as const, teacher: '', room: '', weekday: 1, startTime: '08:00', endTime: '09:00', needsReview: false, batch: 'A2' },
      { raw: '', subjectShort: 'SDC', type: 'lecture' as const, teacher: '', room: '', weekday: 1, startTime: '11:15', endTime: '12:15', needsReview: false },
    ]
    const kept = filterByBatch(all, 'A1')
    expect(kept.map((k) => k.subjectShort)).toEqual(['FE', 'SDC'])
  })
  it('full text import on CSV-ish sample', () => {
    const text = [
      'Monday,08:00,09:00,A1,FE,P,PS,2408',
      'Monday,08:00,09:00,A2,WAD,P,YP,2314',
      'Tuesday,11:15,12:15,A,IKS,L,PS,2406',
    ].join('\n')
    const res = parseTimetableText(text)
    expect(res.entries.length).toBe(3)
    expect(res.warnings.length).toBe(0)
  })
})
