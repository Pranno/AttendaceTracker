// Attendance audit: hand-worked expectations for the cases that matter.
import { describe, expect, it } from 'vitest'
import type { AppData, Mark, Slot } from '../data/model'
import { DEFAULT_SETTINGS, EMPTY_DATA } from '../data/model'
import { buildReport, computeSubjectTotals, slotsForDate, summarizeSubject } from './attendance'
import { projectSubjectMonth } from './projection'

// Mon 2026-11-02 … Fri 2026-11-06 ; "today" = Fri 2026-11-06
const TODAY = '2026-11-06'
const slot = (id: string, subjectId: string, weekday: number, start: string, end: string, extra: Partial<Slot> = {}): Slot => ({
  id, subjectId, weekday, startTime: start, endTime: end, type: 'lecture', room: '', teacher: 'T',
  validFrom: '2026-11-02', validUntil: null, ...extra,
})
const mark = (date: string, slotId: string, status: Mark['status']): Mark => ({ id: `${date}_${slotId}`, date, slotId, status })

function base(over: Partial<AppData> = {}): AppData {
  return {
    ...structuredClone(EMPTY_DATA),
    settings: { ...DEFAULT_SETTINGS, threshold: 75, assumedPastAttendance: 0, semesterStart: '2026-11-02' },
    subjects: [
      { id: 'cp', shortName: 'CP', fullName: 'CP', nicknames: [] },
      { id: 'fe', shortName: 'FE', fullName: 'FE', nicknames: [] },
    ],
    ...over,
  }
}
const tot = (d: AppData, sid: string) => computeSubjectTotals(d, sid, '2026-11-02', TODAY, TODAY)

describe('attendance audit', () => {
  it('marked present/absent count exactly; no class & cancelled count in neither', () => {
    const d = base({
      slots: [1, 2, 3, 4].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')),
      marks: [
        mark('2026-11-02', 'cp1', 'present'),
        mark('2026-11-03', 'cp2', 'absent'),
        mark('2026-11-04', 'cp3', 'noclass'),
        mark('2026-11-05', 'cp4', 'cancelled'),
      ],
    })
    expect(tot(d, 'cp')).toMatchObject({ held: 2, attended: 1 })
  })

  it("today's classes that aren't marked yet don't count against you", () => {
    const d = base({ slots: [slot('cp5', 'cp', 5, '09:00', '10:00'), slot('cp1', 'cp', 1, '09:00', '10:00')], marks: [mark('2026-11-02', 'cp1', 'present')] })
    // Monday present; Friday (today) not marked yet → 1/1, not 1/2
    expect(tot(d, 'cp')).toMatchObject({ held: 1, attended: 1 })
    const withTodayMarked = { ...d, marks: [...d.marks, mark(TODAY, 'cp5', 'absent')] }
    expect(tot(withTodayMarked, 'cp')).toMatchObject({ held: 2, attended: 1 })
  })

  it('past unmarked classes use the assumed % (rounded), marked ones are exact', () => {
    const d = base({ slots: [1, 2, 3, 4].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')), marks: [mark('2026-11-02', 'cp1', 'absent')] })
    d.settings.assumedPastAttendance = 80
    // 3 unmarked past → round(0.8×3)=2 attended; plus 1 absent → 2/4
    expect(tot(d, 'cp')).toMatchObject({ held: 4, attended: 2, unmarkedPast: 3 })
  })

  it('holidays remove classes; exam days still count', () => {
    const d = base({
      slots: [1, 2].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')),
      marks: [mark('2026-11-02', 'cp1', 'present'), mark('2026-11-03', 'cp2', 'present')],
      holidays: [{ id: 'h', startDate: '2026-11-02', endDate: '2026-11-02', label: 'Off', isExamDay: false }],
    })
    expect(tot(d, 'cp')).toMatchObject({ held: 1, attended: 1 })
    d.holidays[0].isExamDay = true
    expect(tot(d, 'cp')).toMatchObject({ held: 2, attended: 2 })
  })

  it('a converted lecture counts for the subject that actually took it', () => {
    const d = base({
      slots: [slot('cp1', 'cp', 1, '09:00', '10:00')],
      marks: [mark('2026-11-02', 'cp1', 'present')],
      conversions: [{ id: 'c', date: '2026-11-02', slotId: 'cp1', subjectId: 'fe' }],
    })
    expect(tot(d, 'cp')).toMatchObject({ held: 0, attended: 0 })
    expect(tot(d, 'fe')).toMatchObject({ held: 1, attended: 1 })
  })

  it('a 2-period lab is ONE session; other batches never count', () => {
    const lab = (id: string, s: string, e: string, batch?: string) => slot(id, 'fe', 1, s, e, { type: 'lab', batch })
    const d = base({
      slots: [lab('l1', '08:00', '09:00', 'A1'), lab('l2', '09:00', '10:00', 'A1'), lab('x1', '08:00', '09:00', 'A2')],
      marks: [mark('2026-11-02', 'l1', 'present')],
    })
    d.settings.myBatch = 'A1'
    expect(slotsForDate(d, '2026-11-02').map((s) => `${s.startTime}-${s.endTime}`)).toEqual(['08:00-10:00'])
    expect(tot(d, 'fe')).toMatchObject({ held: 1, attended: 1 })
  })

  it('editing a class time counts each day once (old version before, new after)', () => {
    const d = base({
      slots: [
        slot('old', 'cp', 1, '09:00', '10:00', { validUntil: '2026-11-08' }),
        slot('new', 'cp', 1, '11:00', '12:00', { validFrom: '2026-11-09' }),
      ],
      marks: [mark('2026-11-02', 'old', 'present'), mark('2026-11-09', 'new', 'present')],
    })
    expect(computeSubjectTotals(d, 'cp', '2026-11-02', '2026-11-09', '2026-11-10')).toMatchObject({ held: 2, attended: 2 })
  })

  it('typed ERP totals replace the calculation', () => {
    const d = base({ slots: [slot('cp1', 'cp', 1, '09:00', '10:00')], marks: [mark('2026-11-02', 'cp1', 'absent')] })
    d.subjects[0].typedHeld = 40
    d.subjects[0].typedAttended = 33
    expect(tot(d, 'cp')).toMatchObject({ held: 40, attended: 33, usesTypedTotals: true })
  })

  it('"can skip" and "attend next" follow the formulas', () => {
    const d = base({ slots: [slot('cp1', 'cp', 1, '09:00', '10:00')] })
    // 15/16 at 75%: can miss floor((1500-1200)/75)=4  (15/20 = 75%)
    let s = summarizeSubject(d, 'cp', { subjectId: 'cp', held: 16, attended: 15, unmarkedPast: 0, usesTypedTotals: false, convertedCount: 0 })
    expect(s.canMiss).toBe(4)
    // 10/16 at 75%: attend next ceil((1200-1000)/25)=8  (18/24 = 75%)
    s = summarizeSubject(d, 'cp', { subjectId: 'cp', held: 16, attended: 10, unmarkedPast: 0, usesTypedTotals: false, convertedCount: 0 })
    expect(s.mustAttendNext).toBe(8)
  })

  it('the month plan and the overall totals agree on what was held this month', () => {
    const d = base({
      slots: [1, 2, 3, 4, 5].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')),
      marks: [mark('2026-11-02', 'cp1', 'present'), mark('2026-11-03', 'cp2', 'absent'), mark('2026-11-04', 'cp3', 'present')],
    })
    d.settings.semesterStart = '2026-11-01'
    const plan = projectSubjectMonth(d, 'cp', '2026-11', TODAY)
    const t = computeSubjectTotals(d, 'cp', '2026-11-01', TODAY, TODAY)
    expect(plan.presentInMonth).toBe(2)
    expect(plan.absentInMonth).toBe(1)
    expect(t).toMatchObject({ held: 3 + 1 /* Thu 5th unmarked past, assumed 0% */, attended: 2 })
    const r = buildReport(d, TODAY, '2026-11-01', TODAY)
    expect(r.bySubject[0].held).toBe(t.held)
  })

  it('"start counting from today only" keeps counting from the day it was switched on', () => {
    const d = base({
      slots: [1, 2, 3, 4, 5].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')),
      marks: [mark('2026-11-03', 'cp2', 'present'), mark('2026-11-04', 'cp3', 'absent'), mark('2026-11-05', 'cp4', 'present')],
    })
    d.settings.assumedPastAttendance = 80
    d.settings.ignorePastAttendance = true
    d.settings.countFromDate = '2026-11-03' // switched on Tuesday
    // viewed on Friday: Tue+Wed+Thu marks count (used to be 0/0); Monday is before → ignored; no assumed %
    expect(tot(d, 'cp')).toMatchObject({ held: 3, attended: 2, unmarkedPast: 0 })
    // switched on before the date was saved → counts from the first marked class
    delete d.settings.countFromDate
    expect(tot(d, 'cp')).toMatchObject({ held: 3, attended: 2 })
  })

  it('"count unmarked classes as present" counts past and today\'s unmarked classes as attended', () => {
    const d = base({
      slots: [1, 2, 3, 4, 5].map((wd) => slot(`cp${wd}`, 'cp', wd, '09:00', '10:00')),
      marks: [mark('2026-11-03', 'cp2', 'absent')],
    })
    d.settings.assumedPastAttendance = 50
    d.settings.unmarkedAsPresent = true
    // Mon, Wed, Thu unmarked → present; Tue absent; Fri (today) unmarked → present
    expect(tot(d, 'cp')).toMatchObject({ held: 5, attended: 4, unmarkedPast: 0 })
  })
})
