import { describe, expect, it } from 'vitest'
import { shouldAutoAdd } from './emailCheck'
import type { Suggestion } from '../data/model'

const base = { id: 's1', title: 'End sem exam form', date: '2026-12-01', status: 'new', category: 'form', from: 'Exam Cell <exam@vupune.ac.in>' } as unknown as Suggestion
const settings = {} as never

describe('email auto-add', () => {
  it('adds official forms from the college domain', () => {
    expect(shouldAutoAdd(base, settings, 'vupune.ac.in')).toBe(true)
  })
  it('keeps scholarships / other as suggestions', () => {
    expect(shouldAutoAdd({ ...base, category: 'other' }, settings, 'vupune.ac.in')).toBe(false)
  })
  it('ignores outside senders when college-only is on', () => {
    expect(shouldAutoAdd({ ...base, from: 'x@unstop.com' }, settings, 'vupune.ac.in')).toBe(false)
    expect(shouldAutoAdd({ ...base, from: 'x@unstop.com' }, { emailCollegeOnly: false } as never, 'vupune.ac.in')).toBe(true)
  })
  it('respects the off switch and needs a date', () => {
    expect(shouldAutoAdd(base, { emailAutoAdd: false } as never, 'vupune.ac.in')).toBe(false)
    expect(shouldAutoAdd({ ...base, date: null }, settings, 'vupune.ac.in')).toBe(false)
  })
})
