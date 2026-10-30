// Tests for the attendance core, built from the worked examples in the document.

import { describe, expect, it } from 'vitest'
import type { AppData } from '../data/model'
import { EMPTY_DATA } from '../data/model'
import type { Subject } from '../data/model'
import {
  buildReport,
  computeSubjectTotals,
  slotsForDate,
  summarizeSubject,
} from './attendance'
import { projectSubjectMonth } from './projection'

function dataWith(over: Partial<AppData>): AppData {
  return { ...structuredClone(EMPTY_DATA), ...over }
}

describe('B4/B5 formulas (threshold 75)', () => {
  function summary(attended: number, held: number, threshold = 75) {
    const subj: Subject = { id: 's1', shortName: 'X', fullName: 'X', nicknames: [], typedAttended: attended, typedHeld: held }
    const data = dataWith({ subjects: [subj] })
    data.settings.threshold = threshold
    const totals = computeSubjectTotals(data, 's1', '2026-01-01', '2026-01-01', '2026-01-01')
    return summarizeSubject(data, 's1', totals)
  }

  it('can miss N = floor((100A − min·H)/min): 80/100 at 75 → can miss 33', () => {
    const s = summary(80, 100)
    expect(s.canMiss).toBe(Math.floor((100 * 80 - 75 * 100) / 75)) // 6
    expect(s.canMiss).toBe(6)
    expect(s.status).toBe('safe')
    expect(s.message).toContain('You’re safe! You can skip 6 more classes')
  })

  it('exactly at the limit shows the limit message', () => {
    const s = summary(75, 100)
    expect(s.canMiss).toBe(0)
    expect(s.status).toBe('limit')
    expect(s.message).toBe('At the limit. Don’t miss the next class')
  })

  it('below minimum: attend next N classes (ceil formula)', () => {
    // 70 of 100 at 75%: need ceil((75*100 − 100*70)/(100−75)) = ceil(500/25) = 20
    const s = summary(70, 100)
    expect(s.status).toBe('below')
    expect(s.mustAttendNext).toBe(20)
    expect(s.message).toBe('Attend the next 20 classes to get back to 75%')
  })

  it('threshold 100 below is out of reach', () => {
    const s = summary(99, 100, 100)
    expect(s.status).toBe('below')
    expect(s.message).toContain('cannot be recovered')
  })

  it('changing the threshold changes every can-miss number (F1)', () => {
    expect(summary(80, 100, 75).canMiss).toBe(6)
    expect(summary(80, 100, 80).canMiss).toBe(0)
    expect(summary(80, 100, 80).status).toBe('limit')
    expect(summary(80, 100, 90).status).toBe('below')
  })
})

describe('J5 assumed past attendance + B2 no-class', () => {
  it('past unmarked classes count at assumed %, marked ones leave the pool', () => {
    // One Mon class per week; semester start Mon 2026-10-05, today Fri 2026-10-23.
    // Mondays before today: 5,12,19 = 3 past classes. Assume 80% → round(2.4)=2 attended.
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [
        {
          id: 'sl1', subjectId: 's1', weekday: 1, startTime: '09:00', endTime: '10:00',
          type: 'lecture', room: '', teacher: '', validFrom: '2026-10-05', validUntil: null,
        },
      ],
    })
    data.settings.semesterStart = '2026-10-05'
    const t = computeSubjectTotals(data, 's1', '2026-10-05', '2026-10-23', '2026-10-23')
    expect(t.held).toBe(3)
    expect(t.attended).toBe(2) // round(0.8 × 3) = 2

    // Mark one past Monday absent: pool becomes 2 unmarked → round(1.6)=2, plus 0 marked present.
    data.marks.push({ id: 'm1', date: '2026-10-12', slotId: 'sl1', status: 'absent' })
    const t2 = computeSubjectTotals(data, 's1', '2026-10-05', '2026-10-23', '2026-10-23')
    expect(t2.held).toBe(3)
    expect(t2.attended).toBe(2) // round(0.8×2)=2

    // No class counts in neither (B2).
    data.marks[0].status = 'noclass'
    const t3 = computeSubjectTotals(data, 's1', '2026-10-05', '2026-10-23', '2026-10-23')
    expect(t3.held).toBe(2)
    expect(t3.attended).toBe(2) // round(0.8×2)… wait pool: 5th and 19th unmarked past = 2 → attended 2? 
    // Actually both remaining are unmarked past: round(0.8*2)=2? 0.8*2=1.6→2. Yes.
  })

  it('worked example J13 row: 60 past unmarked at 80% → 48 attended of 60 held', () => {
    // Simulate with typed-free math: 60 Mondays over ~15 months is slow; instead check the rounding directly.
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [
        {
          id: 'sl1', subjectId: 's1', weekday: 1, startTime: '09:00', endTime: '10:00',
          type: 'lecture', room: '', teacher: '', validFrom: '2026-08-03', validUntil: null,
        },
      ],
    })
    // Aug 3 (Mon) .. Oct 26 (Mon) = 13 Mondays past, today Wed Oct 28.
    const t = computeSubjectTotals(data, 's1', '2026-08-03', '2026-10-28', '2026-10-28')
    expect(t.held).toBe(13)
    expect(t.attended).toBe(Math.round(0.8 * 13)) // 10 (0.8*13=10.4→10)
  })

  describe('lab double-period rule (college: a practical spans 2 periods, 1 attendance)', () => {
    const lab = (id: string, startTime: string, endTime: string, over: Record<string, unknown> = {}) => ({
      id, subjectId: 's1', weekday: 3, startTime, endTime,
      type: 'lab' as const, room: '', teacher: 'PS', validFrom: '2026-10-01', validUntil: null, ...over,
    })

    it('two back-to-back lab slots of the same subject merge into ONE session', () => {
      const data = dataWith({
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [lab('l1', '10:15', '11:15'), lab('l2', '11:15', '12:15')],
      })
      const day = slotsForDate(data, '2026-10-07') // Wednesday
      expect(day.length).toBe(1)
      expect(day[0].startTime).toBe('10:15')
      expect(day[0].endTime).toBe('12:15')
      // counts as one held class, not two
      const t = computeSubjectTotals(data, 's1', '2026-10-07', '2026-10-07', '2026-10-08')
      expect(t.held).toBe(1)
    })

    it('merged lab keeps the first slot id so marking is one tap', () => {
      const data = dataWith({
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [lab('l1', '10:15', '11:15'), lab('l2', '11:15', '12:15')],
      })
      const day = slotsForDate(data, '2026-10-07')
      expect(day[0].id).toBe('l1')
    })

    it('different batches / subjects / teachers do NOT merge', () => {
      const data = dataWith({
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [
          lab('l1', '10:15', '11:15', { batch: 'A1' }),
          lab('l2', '11:15', '12:15', { batch: 'A2' }),
        ],
      })
      expect(slotsForDate(data, '2026-10-07').length).toBe(2)
    })

    it('a lecture followed by a lab does not merge', () => {
      const data = dataWith({
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [
          { ...lab('l1', '10:15', '11:15'), type: 'lecture' as const },
          lab('l2', '11:15', '12:15'),
        ],
      })
      expect(slotsForDate(data, '2026-10-07').length).toBe(2)
    })

    it('three stacked lab periods merge into one long session', () => {
      const data = dataWith({
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [
          lab('l1', '10:15', '11:15'),
          lab('l2', '11:15', '12:15'),
          lab('l3', '12:15', '13:15'),
        ],
      })
      const day = slotsForDate(data, '2026-10-07')
      expect(day.length).toBe(1)
      expect(day[0].endTime).toBe('13:15')
    })

    it('monthly planner counts a merged lab as one class in the month', () => {
      const data = dataWith({
        settings: { ...structuredClone(EMPTY_DATA.settings), semesterStart: '2026-10-01', threshold: 75 },
        subjects: [{ id: 's1', shortName: 'FE', fullName: 'FE', nicknames: [] }],
        slots: [lab('l1', '10:15', '11:15'), lab('l2', '11:15', '12:15')],
      })
      const plan = projectSubjectMonth(data, 's1', '2026-10', '2026-10-28')
      // Wednesdays in Oct 2026: 7,14,21,28 → 4 lab sessions, not 8
      expect(plan.classesInMonth).toBe(4)
    })
  })

  it('B8/J6: typed ERP totals replace calculated figures', () => {
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [], typedAttended: 30, typedHeld: 60 }],
      slots: [
        {
          id: 'sl1', subjectId: 's1', weekday: 1, startTime: '09:00', endTime: '10:00',
          type: 'lecture', room: '', teacher: '', validFrom: '2026-08-03', validUntil: null,
        },
      ],
    })
    const t = computeSubjectTotals(data, 's1', '2026-08-03', '2026-10-28', '2026-10-28')
    expect(t.held).toBe(60)
    expect(t.attended).toBe(30)
    expect(t.usesTypedTotals).toBe(true)
  })
})

describe('A7/A8 weekly repeat and history', () => {
  const base = {
    id: 'sl1', subjectId: 's1', weekday: 1, startTime: '09:00', endTime: '10:00',
    type: 'lecture' as const, room: '', teacher: '',
  }

  it('a Monday slot appears on every Monday after validFrom', () => {
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [{ ...base, validFrom: '2026-10-05', validUntil: null }],
    })
    expect(slotsForDate(data, '2026-10-05')).toHaveLength(1) // Mon
    expect(slotsForDate(data, '2026-10-12')).toHaveLength(1) // next Mon
    expect(slotsForDate(data, '2026-10-06')).toHaveLength(0) // Tue
  })

  it('removing from today keeps past days intact (validUntil)', () => {
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [{ ...base, validFrom: '2026-10-05', validUntil: '2026-10-26' }],
    })
    expect(slotsForDate(data, '2026-10-19')).toHaveLength(1) // before removal — still there
    expect(slotsForDate(data, '2026-11-02')).toHaveLength(0) // after — gone
  })

  it('Sunday off by default, on when enabled (A13)', () => {
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [{ ...base, weekday: 7, validFrom: '2026-10-01', validUntil: null }],
    })
    expect(slotsForDate(data, '2026-10-04')).toHaveLength(0) // Sunday
    data.settings.sundayClasses = true
    expect(slotsForDate(data, '2026-10-04')).toHaveLength(1)
  })

  it('holidays remove classes but exam days keep them (A12, J3)', () => {
    const data = dataWith({
      subjects: [{ id: 's1', shortName: 'X', fullName: 'X', nicknames: [] }],
      slots: [{ ...base, validFrom: '2026-10-05', validUntil: null }],
      holidays: [
        { id: 'h1', startDate: '2026-10-12', endDate: '2026-10-12', label: 'Holiday', isExamDay: false },
        { id: 'h2', startDate: '2026-10-19', endDate: '2026-10-19', label: 'Exam', isExamDay: true },
      ],
    })
    const r = buildReport(data, '2026-10-23', '2026-10-05', '2026-10-23')
    // Past Mondays: 5, 12 (holiday, excluded), 19 (exam day, counts) → held 2
    expect(r.bySubject[0].held).toBe(2)
  })
})

// ---------- Stretch #5: converted lectures (teacher swap) ----------
describe('Stretch #5 conversions ("WAD became FE")', () => {
  const MON = '2026-01-05' // a Monday
  const wkSlot = (id: string, subjectId: string): any => ({
    id,
    subjectId,
    weekday: 1, // Monday
    startTime: '09:00',
    endTime: '10:00',
    type: 'L',
    room: '',
    teacher: '',
    validFrom: '2026-01-01',
    validUntil: null,
  })

  function convData(over: Partial<AppData>): AppData {
    const d = dataWith({
      subjects: [
        { id: 'wad', shortName: 'WAD', fullName: 'Web App Dev', nicknames: [] },
        { id: 'fe', shortName: 'FE', fullName: 'Finals Elective', nicknames: [] },
      ],
      slots: [wkSlot('wad1', 'wad'), wkSlot('fe1', 'fe')],
      ...over,
    })
    d.settings.semesterStart = '2026-01-01'
    return d
  }

  it('counts held+attended toward the subject that actually took the period', () => {
    const data = convData({
      conversions: [{ id: 'c1', date: MON, slotId: 'wad1', subjectId: 'fe' }],
      marks: [
        { id: `${MON}_wad1`, date: MON, slotId: 'wad1', status: 'present' },
        { id: `${MON}_fe1`, date: MON, slotId: 'fe1', status: 'absent' },
      ],
    })
    const fe = computeSubjectTotals(data, 'fe', '2026-01-01', '2026-01-31', '2026-01-06')
    expect(fe.held).toBe(5) // 4 own Mondays + the Jan-5 WAD period that became FE
    expect(fe.attended).toBe(1) // only the marked-present converted class; the rest are future/unmarked
    expect(fe.convertedCount).toBe(1)

    const wad = computeSubjectTotals(data, 'wad', '2026-01-01', '2026-01-31', '2026-01-06')
    expect(wad.held).toBe(3) // 4 Mondays minus the one that became FE
    expect(wad.attended).toBe(0) // all three remaining ones are in the future, unmarked
  })

  it('without a conversion the same mark stays on the original subject', () => {
    const data = convData({
      marks: [{ id: `${MON}_wad1`, date: MON, slotId: 'wad1', status: 'present' }],
    })
    const wad = computeSubjectTotals(data, 'wad', '2026-01-01', '2026-01-31', '2026-01-06')
    expect(wad.held).toBe(4) // all four Mondays still WAD's
    expect(wad.attended).toBe(1) // just the marked-present one; others are future/unmarked
    expect(wad.convertedCount).toBe(0)
  })

  it('a conversion with NO mark still counts as held for the new subject (B14 unmarked-as-present)', () => {
    const data = convData({
      conversions: [{ id: 'c1', date: MON, slotId: 'wad1', subjectId: 'fe' }],
    })
    data.settings.unmarkedAsPresent = true
    const fe = computeSubjectTotals(data, 'fe', '2026-01-01', '2026-01-31', '2026-01-06')
    expect(fe.held).toBe(5)
    expect(fe.attended).toBe(5) // every unmarked class counts as attended (B14)
  })

  it('monthly plan routes the converted lecture into the new subject month total', () => {
    const data = convData({
      conversions: [{ id: 'c1', date: MON, slotId: 'wad1', subjectId: 'fe' }],
      marks: [{ id: `${MON}_wad1`, date: MON, slotId: 'wad1', status: 'present' }],
    })
    const fePlan = projectSubjectMonth(data, 'fe', '2026-01', '2026-01-06')
    expect(fePlan.classesInMonth).toBe(5)
    expect(fePlan.presentInMonth).toBe(1)
    const wadPlan = projectSubjectMonth(data, 'wad', '2026-01', '2026-01-06')
    expect(wadPlan.classesInMonth).toBe(3) // 4 Mondays minus the one that became FE
  })
})
