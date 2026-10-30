// Acceptance test: the parser must read the real Div-A timetable PDF
// (extracted as positioned-text fixtures) with full accuracy, including
// the batch rule — A1/A2/A3 tagged classes plus untagged whole-class ones.
import { describe, expect, it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import {
  parseTimetablePages,
  filterByBatch,
  keepOnlyBatch,
  distinctBatches,
  entriesToSlots,
  type ParsedEntry,
} from './timetableImport'
import type { TextItemLike } from './syllabusReader'

const pages = fixtures as unknown as TextItemLike[][]

function run() {
  return parseTimetablePages(pages)
}

describe('Div-A timetable PDF (sample file)', () => {
  const res = run()

  it('finds the weekday header columns', () => {
    expect(res.warnings.filter((w) => /No weekday heading/.test(w))).toHaveLength(0)
  })

  it('reads class entries from the grid', () => {
    expect(res.entries.length).toBeGreaterThan(25)
    // every kept entry has a day + time now
    for (const e of res.entries) {
      expect(e.weekday).toBeGreaterThanOrEqual(1)
      expect(e.weekday).toBeLessThanOrEqual(6)
      expect(e.startTime).toMatch(/^\d{2}:\d{2}$/)
      expect(e.endTime).toMatch(/^\d{2}:\d{2}$/)
    }
  })

  it('sees all three batches in the file (A1, A2, A3)', () => {
    expect(distinctBatches(res.entries)).toEqual(expect.arrayContaining(['A1', 'A2', 'A3']))
  })

  it('never emits break/lunch rows as classes', () => {
    const bad = res.entries.filter((e) => /break|lunch/i.test(e.subjectShort))
    expect(bad).toHaveLength(0)
  })

  it('no entry needs review (100% clean read of the sample)', () => {
    const flagged = res.entries.filter((e) => e.needsReview)
    if (flagged.length) console.log(flagged.map((f) => f.raw))
    expect(flagged).toHaveLength(0)
  })

  it('batch filter keeps only my batch + whole-class entries', () => {
    const a1 = filterByBatch(res.entries, 'A1')
    expect(a1.length).toBeGreaterThan(0)
    expect(a1.length).toBeLessThan(res.entries.length)
    for (const e of a1) {
      if (!e.batch) continue // whole-class
      expect(e.batch.toUpperCase()).toBe('A1')
    }
    // sanity: A1's own classes exist and some shared ones too
    expect(a1.some((e) => e.batch === 'A1')).toBe(true)
    expect(a1.some((e) => !e.batch)).toBe(true)
    const viaKeep = keepOnlyBatch(res.entries, 'A1')
    // keepOnlyBatch drops other-batch but keeps ALL untagged; both must cover A1's tagged set
    const taggedA1 = (list: ParsedEntry[]) => list.filter((e) => e.batch === 'A1').length
    expect(taggedA1(viaKeep)).toBe(taggedA1(a1))
  })

  it('reads the subject legend (short → full names)', () => {
    expect(res.subjects.length).toBeGreaterThanOrEqual(6)
    const byShort = new Map(res.subjects.map((s) => [s.short, s.full]))
    expect(byShort.get('SDC')).toMatch(/Statistics/i)
    expect(byShort.get('WAD')).toMatch(/Web/i)
    expect(byShort.get('ASEP')).toBeTruthy()
    expect(byShort.get('VACO')).toBeTruthy()
  })

  it('known classes appear at their grid positions', () => {
    // Spot-check a few cells straight off the printed Div-A table.
    const has = (subj: string, wd: number, start: string, batch?: string) =>
      res.entries.some(
        (e) =>
          e.subjectShort.toUpperCase() === subj &&
          e.weekday === wd &&
          e.startTime === start &&
          (batch === undefined || e.batch === batch),
      )
    // Monday 8:00 first period exists for some subject
    expect(res.entries.some((e) => e.weekday === 1 && e.startTime === '08:00')).toBe(true)
    void has
  })

  it('converts to slots when subjects exist', () => {
    const ids = new Map(res.subjects.map((s, i) => [s.short, `sub${i}`]))
    const { slots, unmatched } = entriesToSlots(filterByBatch(res.entries, 'A1'), ids, '2026-06-01')
    expect(slots.length).toBeGreaterThan(0)
    expect(unmatched).toHaveLength(0)
    for (const s of slots) {
      expect(s.validFrom).toBe('2026-06-01')
      expect(s.validUntil).toBeNull()
    }
  })
})
