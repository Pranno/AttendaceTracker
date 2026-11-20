import { describe, expect, it } from 'vitest'
import { extractHolidays } from './holidays'
import { extractDeadlines } from './deadlines'

const T = '2026-11-20'
const h = (msg: string) => extractHolidays(msg, T).map((x) => `${x.label} | ${x.startDate} → ${x.endDate}`)

describe('holiday notices (Standard reader)', () => {
  it('single day with a reason', () => {
    expect(h('Dear students, the college will remain closed on 25/11 on account of Guru Nanak Jayanti.')).toEqual([
      'Guru Nanak Jayanti | 2026-11-25 → 2026-11-25',
    ])
  })
  it('ranges in the common spellings', () => {
    expect(h('Diwali vacation from 10/12 to 15/12')).toEqual(['Diwali vacation | 2026-12-10 → 2026-12-15'])
    expect(h('Winter break: 24th to 31st December')).toEqual(['Winter break | 2026-12-24 → 2026-12-31'])
    expect(h('Holidays 28/12 - 2/1 for Christmas and New Year')).toEqual(['Christmas and New Year | 2026-12-28 → 2027-01-02'])
  })
  it('other ways of saying it', () => {
    expect(h('No lectures on 3rd Dec due to the annual sports day')).toEqual(['Annual sports day | 2026-12-03 → 2026-12-03'])
    expect(h('Classes suspended on 5/12')).toEqual(['Holiday | 2026-12-05 → 2026-12-05'])
    expect(h('Tomorrow 21 Nov 2026 is declared a holiday')).toEqual(['Holiday | 2026-11-21 → 2026-11-21'])
  })
  it('dates on the next line', () => {
    expect(h('Diwali vacation:\n10/12 to 12/12')).toEqual(['Diwali vacation | 2026-12-10 → 2026-12-12'])
  })
  it('ignores messages that are not holidays', () => {
    expect(h('DSA assignment submission on 5/12')).toEqual([])
    expect(h('Holiday homework is due next week')).toEqual([]) // no date
  })
  it('a holiday line is not ALSO reported as a deadline', () => {
    const msg = 'The college will remain closed on 25/11.\nWAD lab file submission on 27/11'
    expect(extractDeadlines(msg, T).map((d) => d.title)).toEqual(['WAD lab file submission'])
    expect(extractHolidays(msg, T)).toHaveLength(1)
  })
})
