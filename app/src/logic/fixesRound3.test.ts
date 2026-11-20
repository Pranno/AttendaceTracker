import { describe, expect, it } from 'vitest'
import { parseBackup } from '../data/storage'
import { EMPTY_DATA } from '../data/model'
import { entriesToSlots, type ParsedEntry } from './timetableImport'
import { toSuggestions } from './gmail'

describe('restore backup', () => {
  it('accepts an exported backup and fills missing fields', () => {
    const exported = { ...structuredClone(EMPTY_DATA), subjects: [{ id: 'a', shortName: 'CP', fullName: 'CP', nicknames: [] }] }
    delete (exported as Partial<typeof exported>).conversions // older backup without a newer field
    const r = parseBackup(JSON.stringify(exported))
    expect(r.subjects).toHaveLength(1)
    expect(r.conversions).toEqual([])
  })
  it('rejects files that are not backups without touching anything', () => {
    expect(() => parseBackup('not json')).toThrow(/not a valid backup/)
    expect(() => parseBackup('[1,2]')).toThrow()
    expect(() => parseBackup('{"hello":1}')).toThrow(/no subjects/)
    expect(() => parseBackup('{"subjects":[],"slots":{}}')).toThrow(/damaged/)
  })
})

describe('timetable import', () => {
  it('saves VACO-I classes under the VACO-I subject (were silently dropped)', () => {
    const e: ParsedEntry = {
      raw: '', subjectShort: 'VACO-I', type: 'lecture', teacher: 'JK', room: '2403',
      weekday: 5, startTime: '09:00', endTime: '10:00', needsReview: false,
    }
    const { slots, unmatched } = entriesToSlots([e], new Map([['VACO-I', 'subj_v']]), '2026-11-19')
    expect(unmatched).toHaveLength(0)
    expect(slots[0].subjectId).toBe('subj_v')
  })
})

describe('email suggestions', () => {
  it('carry the matched subject id', () => {
    const out = toSuggestions(
      [{
        message: { id: 'm1', subject: 'CP', from: '', snippet: '', body: '', date: '2026-11-19' },
        items: [{ title: 'Lab report', dueDate: '2026-11-25', subjectHint: 'CP', tentative: false, sourceLine: 'CP lab report due 25/11' }],
      }],
      [],
      [{ id: 'subj_cp', shortName: 'CP', fullName: 'Computer Programming', nicknames: [] }],
    )
    expect(out[0].subjectId).toBe('subj_cp')
  })
})
