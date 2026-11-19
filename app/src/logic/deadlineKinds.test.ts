import { describe, expect, it } from 'vitest'
import { extractDeadlines } from './deadlines'

const T = '2026-11-19'
const one = (msg: string) => extractDeadlines(msg, T)

describe('Standard reader catches every kind of deadline', () => {
  const cases: [string, string][] = [
    ['Mid-sem exam of SDC on 2/12', '2026-12-02'],
    ['DSA assignment submission on 5/12', '2026-12-05'],
    ['Hackathon registration closes on 25/11', '2026-11-25'],
    ['Fill the scholarship form before 30/11', '2026-11-30'],
    ['Exam fee payment last date 28 Nov', '2026-11-28'],
    ['Apply for the internship by 3 Dec', '2026-12-03'],
    ['Enrolment for NPTEL courses ends 1/12', '2026-12-01'],
    ['Practical journal to be checked on 4/12', '2026-12-04'],
    ['Seminar presentation on 6 Dec', '2026-12-06'],
    ['Hall ticket download from 8/12', '2026-12-08'],
    ['Viva for CP lab on 9/12', '2026-12-09'],
  ]
  for (const [msg, date] of cases) {
    it(msg, () => {
      const r = one(msg)
      expect(r).toHaveLength(1)
      expect(r[0].dueDate).toBe(date)
      expect(r[0].title.length).toBeGreaterThan(2)
    })
  }
  it('keeps the kind of task in the title', () => {
    expect(one('Hackathon registration closes on 25/11')[0].title.toLowerCase()).toContain('registration')
    expect(one('Mid-sem exam of SDC on 2/12')[0].title.toLowerCase()).toContain('exam')
  })
})
