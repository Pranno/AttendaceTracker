import { describe, it, expect } from 'vitest'
import { extractDeadlines, matchSubject } from './deadlines'

const TODAY = '2026-10-28'

describe('extractDeadlines', () => {
  it('extracts a simple numeric-date submission line', () => {
    const r = extractDeadlines('DSA assignment submission on 5/11', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2026-11-05')
    expect(r[0].subjectHint).toBe('DSA')
    expect(r[0].tentative).toBe(false)
  })

  it('handles "DD Month" word format', () => {
    const r = extractDeadlines('DBMS project last date is 12th November', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2026-11-12')
    expect(r[0].subjectHint).toBe('DBMS')
  })

  it('handles "Month DD" word format', () => {
    const r = extractDeadlines('Exam: Jan 15 for Maths', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2027-01-15') // rolled to next year (far in past)
    expect(r[0].tentative).toBe(true)
  })

  it('extracts multiple deadlines from one message', () => {
    const msg = [
      'Dear students,',
      '1. DSA lab manual submission 3/11',
      '2. DBMS quiz on 10 Nov',
      'Regards, Prof X',
    ].join('\n')
    const r = extractDeadlines(msg, TODAY)
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r.map((x) => x.dueDate)).toContain('2026-11-03')
    expect(r.map((x) => x.dueDate)).toContain('2026-11-10')
  })

  it('ignores lines with dates but no deadline keyword', () => {
    const r = extractDeadlines('Class will be held on 5/11 in room 204', TODAY)
    expect(r).toHaveLength(0)
  })

  it('ignores lines with keyword but no date', () => {
    const r = extractDeadlines('Assignment submission is important', TODAY)
    expect(r).toHaveLength(0)
  })

  it('cleans title of date and keyword tokens', () => {
    const r = extractDeadlines('Internal assessment 2 submission – 20/11', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].title.toLowerCase()).toContain('internal assessment 2')
    expect(r[0].title).not.toMatch(/submission/i)
    expect(r[0].title).not.toMatch(/20\/11/)
  })

  it('deduplicates identical title+date pairs', () => {
    const msg = 'DSA assignment submission 5/11\nDSA assignment submission 5/11'
    const r = extractDeadlines(msg, TODAY)
    expect(r).toHaveLength(1)
  })

  it('keeps near-past dates as this year (within 6 months)', () => {
    const r = extractDeadlines('Marks upload due 15/10', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2026-10-15')
    expect(r[0].tentative).toBe(false)
  })

  it('handles hand-in phrasing', () => {
    const r = extractDeadlines('SE report hand in 1 Dec', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2026-12-01')
    expect(r[0].subjectHint).toBe('SE')
  })

  it('returns empty array for empty input', () => {
    expect(extractDeadlines('', TODAY)).toEqual([])
    expect(extractDeadlines('   \n  ', TODAY)).toEqual([])
  })

  it('matches user subjects by short name, full name, and nicknames (M6)', () => {
    const subjects = [
      { id: 's1', shortName: 'SDC', fullName: 'Statistics and Differential Calculus', nicknames: ['Maths', 'Calculus'] },
      { id: 's2', shortName: 'WAD', fullName: 'Web Application Development', nicknames: ['Web Dev'] },
    ]
    const r1 = extractDeadlines('Maths submission of integration worksheet at 9 Nov', TODAY, subjects)
    expect(r1).toHaveLength(1)
    expect(r1[0].subjectHint).toBe('SDC')

    const r2 = extractDeadlines('All the 10 certificates mentioned in WAD syllabus to be completed and shown before 30th October', TODAY, subjects)
    expect(r2).toHaveLength(1)
    expect(r2[0].subjectHint).toBe('WAD')
    expect(r2[0].dueDate).toBe('2026-10-30')
  })

  it('ignores hyphenated numbers without a year like Grades 1-12 (M5/C12)', () => {
    const r = extractDeadlines('Grades 1-12 test submission on 15/11', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].dueDate).toBe('2026-11-15')
  })

  it('preserves sourceLine for preview UI', () => {
    const src = 'CN presentation on 25/11'
    const r = extractDeadlines(src, TODAY)
    expect(r[0].sourceLine).toBe(src)
  })
})

describe('matchSubject', () => {
  it('matches short forms', () => {
    expect(matchSubject('DSA internal test')).toBe('DSA')
    expect(matchSubject('OS quiz')).toBe('OS')
    expect(matchSubject('Maths exam')).toBe('Maths')
  })
  it('returns undefined when nothing matches', () => {
    expect(matchSubject('meeting tomorrow')).toBeUndefined()
  })
})
