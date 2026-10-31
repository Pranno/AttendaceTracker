import { describe, expect, it } from 'vitest'
import type { AppData, Slot, Subject } from '../data/model'
import { DEFAULT_SETTINGS, EMPTY_DATA } from '../data/model'
import { buildMonthPlan, planMonths, projectSubjectMonth } from './projection'

function makeData(overrides?: Partial<AppData>): AppData {
  const maths: Subject = {
    id: 'subj_maths',
    shortName: 'Maths',
    fullName: 'Mathematics',
    nicknames: ['Calculus'],
  }
  return {
    ...structuredClone(EMPTY_DATA),
    subjects: [maths],
    settings: {
      ...DEFAULT_SETTINGS,
      threshold: 80,
      semesterStart: '2026-08-01',
      semesterEnd: '2026-12-31',
      assumedPastAttendance: 80,
    },
    ...overrides,
  }
}

/** Build dated lecture slots: `days` class days in Nov 2026 x 5 periods each.
 *  Explicit per-date validity keeps the fixture independent of which weekday
 *  2026-11-01 falls on. */
function monthDaySlots(monthKeyStr: string, days: number, prefix = 'sl', wdFilter?: (wd: number) => boolean): Slot[] {
  const classDays: string[] = []
  for (let day = 1; day <= 31 && classDays.length < days; day++) {
    const ds = `${monthKeyStr}-${String(day).padStart(2, '0')}`
    const dow = new Date(`${ds}T00:00:00`).getDay()
    const ok = wdFilter ? wdFilter(dow) : dow >= 1 && dow <= 6
    if (ok) classDays.push(ds)
  }
  const slots: Slot[] = []
  for (const date of classDays) {
    const wd = new Date(`${date}T00:00:00`).getDay()
    for (let i = 0; i < 5; i++) {
      slots.push({
        id: `${prefix}_${date}_${i}`,
        subjectId: 'subj_maths',
        weekday: wd,
        startTime: `0${8 + i}:00`,
        endTime: `0${9 + i}:00`,
        type: 'lecture',
        room: '101',
        teacher: 'Prof M',
        validFrom: date,
        validUntil: date,
      })
    }
  }
  return slots
}

describe('Section J: Monthly Attendance Plan worked examples (threshold 80%)', () => {
  it('Worked example 1: November, 100 classes, no earlier classes -> must attend 80, can skip 20', () => {
    const d = makeData()
    d.subjects[0].typedHeld = 0
    d.subjects[0].typedAttended = 0

    d.slots = monthDaySlots('2026-11', 20, 'sl', (w) => w >= 1 && w <= 5)

    const plan = projectSubjectMonth(d, 'subj_maths', '2026-11', '2026-11-01')
    expect(plan.classesInMonth).toBe(100)
    expect(plan.priorHeld).toBe(0)
    expect(plan.priorAttended).toBe(0)
    expect(plan.neededTotal).toBe(80)
    expect(plan.mustAttend).toBe(80)
    expect(plan.canSkip).toBe(20)
    expect(plan.outOfReach).toBe(false)
    expect(plan.status).toBe('safe')
    expect(plan.verdict).toBe('You can skip 20 more. Nice!')
  })

  it('Worked example 2: User skips 2 classes -> 98 left, must attend 80, can skip 18', () => {
    const d = makeData()
    d.subjects[0].typedHeld = 0
    d.subjects[0].typedAttended = 0

    d.slots = monthDaySlots('2026-11', 20, 'sl', (w) => w >= 1 && w <= 5)
    d.marks.push({ id: 'm1', date: '2026-11-02', slotId: 'sl_2026-11-02_0', status: 'absent' })
    d.marks.push({ id: 'm2', date: '2026-11-02', slotId: 'sl_2026-11-02_1', status: 'absent' })

    const plan = projectSubjectMonth(d, 'subj_maths', '2026-11', '2026-11-03')
    expect(plan.classesInMonth).toBe(100)
    expect(plan.absentInMonth).toBe(2)
    expect(plan.classesLeft).toBe(98)
    expect(plan.mustAttend).toBe(80)
    expect(plan.canSkip).toBe(18)
    expect(plan.status).toBe('safe')
    expect(plan.verdict).toBe('You can skip 18 more. Nice!')
  })

  it('Worked example 3: November ends with 98/100. December has 100 classes -> must attend 62, can skip 38', () => {
    const d = makeData()
    d.subjects[0].typedHeld = 100
    d.subjects[0].typedAttended = 98

    d.slots = monthDaySlots('2026-12', 20, 'sl_dec', (w) => w >= 1 && w <= 5)

    const plan = projectSubjectMonth(d, 'subj_maths', '2026-12', '2026-12-01')
    expect(plan.priorHeld).toBe(100)
    expect(plan.priorAttended).toBe(98)
    expect(plan.classesInMonth).toBe(100)
    expect(plan.neededTotal).toBe(160)
    expect(plan.mustAttend).toBe(62)
    expect(plan.canSkip).toBe(38)
    expect(plan.status).toBe('safe')
    expect(plan.verdict).toBe('You can skip 38 more. Nice!')
  })

  it('Worked example 4: 28 attended of 40 held before month, 100 classes -> must attend 84, can skip 16', () => {
    const d = makeData()
    d.subjects[0].typedHeld = 40
    d.subjects[0].typedAttended = 28

    d.slots = monthDaySlots('2026-11', 20, 'sl_nov', (w) => w >= 1 && w <= 5)

    const plan = projectSubjectMonth(d, 'subj_maths', '2026-11', '2026-11-01')
    expect(plan.priorHeld).toBe(40)
    expect(plan.priorAttended).toBe(28)
    expect(plan.classesInMonth).toBe(100)
    expect(plan.neededTotal).toBe(112)
    expect(plan.mustAttend).toBe(84)
    expect(plan.canSkip).toBe(16)
    expect(plan.status).toBe('safe')
  })

  it('Worked example 7: Out of reach: 30 attended of 60 held, 20 classes in month -> ends on 62.5%', () => {
    const d = makeData()
    d.subjects[0].typedHeld = 60
    d.subjects[0].typedAttended = 30

    // 4 class days x 5 slots = 20 classes
    d.slots = monthDaySlots('2026-11', 4, 'sl_daily', (w) => w === 1)

    const plan = projectSubjectMonth(d, 'subj_maths', '2026-11', '2026-11-01')
    expect(plan.classesInMonth).toBe(20)
    expect(plan.priorHeld).toBe(60)
    expect(plan.priorAttended).toBe(30)
    expect(plan.neededTotal).toBe(64)
    expect(plan.mustAttend).toBe(34)
    expect(plan.outOfReach).toBe(true)
    expect(plan.canSkip).toBe(0)
    expect(plan.endPercent).toBe(62.5)
    expect(plan.status).toBe('below')
    expect(plan.verdict).toContain('Out of reach this month. Attend all 20 to reach 62.5%')
  })

  it('J14: subject with no classes in a month shows "No classes this month"', () => {
    const d = makeData({ slots: [] })
    const plan = projectSubjectMonth(d, 'subj_maths', '2026-11', '2026-11-01')
    expect(plan.classesInMonth).toBe(0)
    expect(plan.status).toBe('nodata')
    expect(plan.verdict).toBe('No classes this month')
  })

  it('J1: buildMonthPlan returns per-subject plans with no overall total', () => {
    const d = makeData()
    const plan = buildMonthPlan(d, '2026-11', '2026-11-01')
    expect(plan.monthKey).toBe('2026-11')
    expect(plan.subjects).toHaveLength(1)
    expect((plan as unknown as { overallHeld?: number }).overallHeld).toBeUndefined()
  })

  it('planMonths lists months from start to end', () => {
    const d = makeData()
    const months = planMonths(d, '2026-10-28')
    expect(months).toContain('2026-10')
    expect(months).toContain('2026-11')
    expect(months).toContain('2026-12')
  })
})
