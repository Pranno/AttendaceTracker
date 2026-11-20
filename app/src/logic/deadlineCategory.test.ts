import { describe, expect, it } from 'vitest'
import { categorize, collegeDomainOf, fromCollege, importantSubjectPattern } from './deadlineCategory'

describe('deadline categories (what may be auto-added from email)', () => {
  const cases: [string, string][] = [
    ['Mid-sem exam of SDC on 2 Dec', 'exam'],
    ['Hall ticket download from 8/12', 'exam'],
    ['WAD lab file submission by 27/11', 'submission'],
    ['Mini project report to be submitted', 'submission'],
    ['Fill the exam form before 30/11', 'form'],
    ['Exam fee payment last date 28 Nov', 'form'],
    ['Elective course registration closes 1 Dec', 'form'],
    ['Annual cultural fest on 15 Dec', 'event'],
    ['Convocation ceremony on 20 Dec', 'event'],
    ['Apply for the merit scholarship by 30/11', 'other'],
    ['Scholarship form last date 30/11', 'other'], // a form, but a scholarship one
    ['Internship applications close on 5/12', 'other'],
    ['Register for the national hackathon by 3/12', 'other'],
    ['Webinar on AI careers, register by 2/12', 'other'],
    ['Something due on 4/12', 'other'],
  ]
  for (const [t, c] of cases) it(`${t} → ${c}`, () => expect(categorize(t)).toBe(c))

  it('college domain from the connected account', () => {
    expect(collegeDomainOf('pranjal@vupune.ac.in')).toBe('vupune.ac.in')
    expect(collegeDomainOf('me@gmail.com')).toBeNull()
    expect(fromCollege('Exam Cell <exams@vupune.ac.in>', 'vupune.ac.in')).toBe(true)
    expect(fromCollege('CSE <hod@cse.vupune.ac.in>', 'vupune.ac.in')).toBe(true)
    expect(fromCollege('Scholarships <noreply@buddy4study.com>', 'vupune.ac.in')).toBe(false)
    expect(fromCollege('anyone@x.com', null)).toBe(true)
  })

  it('background pattern covers the chosen categories only', () => {
    const re = new RegExp(importantSubjectPattern(['exam', 'form']).replace('(?i)', ''), 'i')
    expect(re.test('Mid-sem exam timetable')).toBe(true)
    expect(re.test('Exam form submission')).toBe(true)
    expect(re.test('Annual fest')).toBe(false)
  })
})
