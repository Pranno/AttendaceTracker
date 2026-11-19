import { describe, expect, it } from 'vitest'
import { extractDeadlines } from './deadlines'

describe('deadline extraction edge cases', () => {
  it('a dotted clock time is not a date', () => {
    const r = extractDeadlines('Submit report by 10.30 am on 5 Jan', '2026-11-19')
    expect(r[0].dueDate).toBe('2027-01-05')
  })
  it('invalid calendar dates are skipped instead of rolling over', () => {
    expect(extractDeadlines('Assignment due 31/02/2027', '2026-11-19')).toHaveLength(0)
  })
  it('an explicit year is not tentative', () => {
    const r = extractDeadlines('Assignment due 10/01/2027', '2026-11-19')
    expect(r[0].dueDate).toBe('2027-01-10')
    expect(r[0].tentative).toBe(false)
  })
})
