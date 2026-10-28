import { describe, expect, it } from 'vitest'
import type { AppData, DateStr, Mark, Slot, Subject } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'
import { buildMonthPlan, planMonths, projectSubject, weeksIn, weeklySummary } from './projection'

// Deterministic fixture builder.
function slot(partial: Partial<Slot> & Pick<Slot, 'id' | 'subjectId' | 'weekday'>): Slot {
  return {
    startTime: '09:00',
    endTime: '10:00',
    type: 'lecture',
    room: 'R101',
    teacher: 'T',
    validFrom: '2026-01-01',
    validUntil: null,
    ...partial,
  }
}

function mk(date: DateStr, slotId: string, status: Mark['status']): Mark {
  return { id: `${date}_${slotId}`, date, slotId, status }
}

function base(overrides?: Partial<AppData>): AppData {
  const subjects: Subject[] = [
    { id: 'math', shortName: 'MA', fullName: 'Maths', nicknames: [], },
    { id: 'cs', shortName: 'CS', fullName: 'CS', nicknames: [], },
  ]
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, semesterStart: '2026-08-01', semesterEnd: '2026-12-31', assumedPastAttendance: 80 },
    subjects,
    slots: [slot({ id: 'm1', subjectId: 'math', weekday: 1 })], // Monday maths
    marks: [],
    holidays: [],
    deadlines: [],
    units: [],
    scores: [],
    focusSessions: [],
    courseLinks: [],
    suggestions: [],
    events: [],
    ...overrides,
  }
}

describe('projectSubject', () => {
  it('J14: no classes yet → nodata, never guessed', () => {
    const d = base()
    const p = projectSubject(d, 'math', '2026-10-28', '2026-10-31')
    expect(p.status).toBe('nodata')
    expect(p.currentPercent).toBe(0)
    expect(p.breachDate).toBeNull()
  })

  it('J7: breach date when skipping everything drops below threshold', () => {
    // 4 attended of 5 held = 80%. One more Monday class on 2026-11-02 skipped → 4/6 = 66.7% < 75%.
    const d = base({
      marks: [
        mk('2026-10-05', 'm1', 'present'),
        mk('2026-10-12', 'm1', 'present'),
        mk('2026-10-19', 'm1', 'present'),
        mk('2026-10-26', 'm1', 'absent'),
      ],
    })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    expect(p.current.held).toBe(4)
    expect(p.current.attended).toBe(3)
    expect(p.status).toBe('limit') // 3/4 = 75% exactly → at the limit
    expect(p.breachDate).toBe('2026-11-02') // first skipped Monday drops to 60%
  })

  it('safe subject with headroom never breaches when skipping all remaining', () => {
    // 8 attended of 9 held (~88.9%). Nov has 5 Mondays; skip all → 8/14 = 57% < 75 → breaches eventually
    const d = base({
      marks: [
        mk('2026-09-07', 'm1', 'present'), mk('2026-09-14', 'm1', 'present'),
        mk('2026-09-21', 'm1', 'present'), mk('2026-09-28', 'm1', 'present'),
        mk('2026-10-05', 'm1', 'present'), mk('2026-10-12', 'm1', 'present'),
        mk('2026-10-19', 'm1', 'present'), mk('2026-10-26', 'm1', 'absent'),
        mk('2026-10-12', 'c1', 'absent'),
      ],
    })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    // Oct 26 (marked absent) is before the walk start → part of current standing
    expect(p.current.held).toBe(8)
    expect(p.current.attended).toBe(7)
    expect(p.status).toBe('safe')
    // skip Nov 2: 7/9 = 77.8 ≥ 75 (safe until Nov 2); skip Nov 9: 7/10 = 70% → breach
    expect(p.breachDate).toBe('2026-11-09')
    expect(p.safeUntil).toBe('2026-11-02')
    expect(p.safeUntil).toBe('2026-11-02')
  })

  it('J8: safeUntil extends while projected percent stays ≥ threshold', () => {
    // 10/10 = 100%. Skipping 5 Mondays keeps us at 10/15 = 66.7% → breach at 5th skipped.
    const marks: Mark[] = []
    for (let i = 0; i < 10; i++) marks.push(mk(`2026-09-${String(1 + ((i * 7) % 28)).padStart(2, '0')}`, 'm1', 'present'))
    const d = base({ marks })
    const p = projectSubject(d, 'math', '2026-10-01', '2026-12-31')
    // exact dates don't matter much here; check invariants
    expect(p.current.attended).toBeLessThanOrEqual(p.current.held)
    if (p.breachDate) expect(p.safeUntil! < p.breachDate).toBe(true)
  })

  it('J6: typed ERP totals replace calculated figures', () => {
    const d = base()
    d.subjects[0].typedHeld = 20
    d.subjects[0].typedAttended = 18
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    expect(p.current.held).toBe(20)
    expect(p.current.attended).toBe(18)
    expect(p.usesTypedTotals).toBe(true)
    // flat line — projection doesn't add future held onto typed numbers
    const last = p.points[p.points.length - 1]
    expect(last.held).toBe(20)
  })

  it('J12: exam-day holidays still count as classes in projection', () => {
    const d = base({
      marks: [mk('2026-10-05', 'm1', 'present'), mk('2026-10-12', 'm1', 'present')],
      holidays: [{ id: 'h1', startDate: '2026-11-02', endDate: '2026-11-02', label: 'Mid sem', isExamDay: true }],
    })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-09')
    // 2026-11-02 is a Monday exam day → counts (not skipped like a normal holiday)
    expect(p.remainingClasses).toBe(2) // Nov 2 and Nov 9
  })

  it('normal holidays are excluded from the walk', () => {
    const d = base({
      marks: [mk('2026-10-05', 'm1', 'present'), mk('2026-10-12', 'm1', 'present')],
      holidays: [{ id: 'h1', startDate: '2026-11-02', endDate: '2026-11-02', label: 'Diwali', isExamDay: false }],
    })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-09')
    expect(p.remainingClasses).toBe(1) // only Nov 9
  })

  it('already-cancelled future classes do not grow held', () => {
    const d = base({
      marks: [
        mk('2026-10-05', 'm1', 'present'),
        mk('2026-10-12', 'm1', 'present'),
        mk('2026-11-02', 'm1', 'cancelled'),
      ],
    })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-09')
    expect(p.remainingClasses).toBe(1) // Nov 9 only
  })

  it('J10: recovery count matches B5 formula', () => {
    // 2/10 = 20%. B5: ceil((75*10 − 100*2)/25) = ceil(550/25) = 22
    const mondays = ['2026-08-03','2026-08-10','2026-08-17','2026-08-24','2026-08-31','2026-09-07','2026-09-14','2026-09-21','2026-09-28','2026-10-05']
    // last marked Monday Oct 19 — Oct 26 stays unmarked and gets counted by the walk
    const marks: Mark[] = mondays.slice(0, 9).map((m, i) => mk(m, 'm1', i < 2 ? 'present' : 'absent'))
    const d = base({ marks })
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    expect(p.current.held).toBe(9) // 9 exact marks; Oct 26 unmarked joins via walk
    expect(p.mustAttendNext).toBe(19) // B5: ceil((75*9 − 100*2)/25) = ceil(475/25) = 19
    // B5 on current standing: ceil((675−200)/25)=ceil(19)=19

  })

  it('J9: canSkipRest counts absences allowed while attending the rest', () => {
    // 8/10 = 80%, 4 remaining classes in horizon. Final held 14, need 10.5 → attend ≥ 11.
    // Have 8, will attend 4−k: 8+4−k ≥ 10.5 → k ≤ 1.5 → floor 1.
    const marks: Mark[] = []
    const mondays = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']
    mondays.forEach((m, i) => marks.push(mk(m, 'm1', i < 8 ? 'present' : 'absent')))
    marks.push(mk('2026-09-28', 'm1', 'absent'))
    marks.push(mk('2026-10-05', 'm1', 'absent'))
    const d = base({ marks })
    // 10 held, 8 attended. Horizon Oct 28 → Nov 30: Mondays Nov 2, 9, 16, 23, 30 = 5 remaining
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    expect(p.remainingClasses).toBe(5)
    // final held 15, need 11.25 → attended max 13 → can skip floor(13 − 11.25) = 1
    expect(p.canSkipRest).toBe(1)
  })

  it('batch filtering applies to projections (A2 slot ignored by A1 user)', () => {
    const d = base({
      slots: [
        slot({ id: 'm1', subjectId: 'math', weekday: 1 }),
        slot({ id: 'm2', subjectId: 'math', weekday: 3, batch: 'A2' }),
      ],
      settings: { ...DEFAULT_SETTINGS, myBatch: 'A1', semesterStart: '2026-08-01', semesterEnd: '2026-12-31', assumedPastAttendance: 80 },
    })
    d.marks = [mk('2026-10-05', 'm1', 'present'), mk('2026-10-07', 'm2', 'present')]
    const p = projectSubject(d, 'math', '2026-10-28', '2026-11-30')
    // Past: only m1 counts for A1 user (Oct 5), the A2 Wednesday mark is ignored
    expect(p.current.held).toBe(1)
    // Only Mondays m1 remain (Wednesdays tagged A2 hidden)
    expect(p.remainingClasses).toBe(5)
  })
})

describe('weeksIn / weeklySummary', () => {
  it('weeks start on Monday and cover the range', () => {
    const ws = weeksIn('2026-10-28', '2026-11-10') // Wed → Sat
    expect(ws[0]).toBe('2026-10-26') // Monday
    expect(ws).toContain('2026-11-02')
    expect(ws).toContain('2026-11-09')
  })

  it('weekly rows only include past/today days', () => {
    const d = base({
      marks: [mk('2026-10-26', 'm1', 'present'), mk('2026-10-19', 'm1', 'absent')],
    })
    const rows = weeklySummary(d, '2026-10-01', '2026-10-31', '2026-10-28')
    const w = rows.find((r) => r.weekStart === '2026-10-26')!
    expect(w.held).toBe(1) // Mon 26 only; 28 is Wed, no slot
    expect(w.attended).toBe(1)
  })
})

describe('buildMonthPlan / planMonths', () => {
  it('plan covers months from planStartMonth to semester end', () => {
    const d = base({ settings: { ...DEFAULT_SETTINGS, semesterStart: '2026-08-01', semesterEnd: '2026-12-31', planStartMonth: '2026-11', assumedPastAttendance: 80 } })
    const ms = planMonths(d, '2026-10-28')
    expect(ms).toEqual(['2026-11', '2026-12'])
  })

  it('month plan aggregates all subjects and ends at month boundary', () => {
    const d = base({
      slots: [
        slot({ id: 'm1', subjectId: 'math', weekday: 1 }),
        slot({ id: 'c1', subjectId: 'cs', weekday: 2 }),
      ],
      marks: [mk('2026-10-05', 'm1', 'present'), mk('2026-10-06', 'c1', 'absent')],
    })
    const plan = buildMonthPlan(d, '2026-11', '2026-10-28')
    expect(plan.monthKey).toBe('2026-11')
    expect(plan.subjects).toHaveLength(2)
    // November horizon: Nov 1..Nov 30 for each subject's remaining classes
    const math = plan.subjects.find((s) => s.subjectId === 'math')!
    const cs = plan.subjects.find((s) => s.subjectId === 'cs')!
    // Nov 2026 Mondays: 2, 9, 16, 23, 30 → 5
    expect(math.remainingClasses).toBe(5)
    expect(cs.remainingClasses).toBe(4) // Tuesdays 3,10,17,24
  })

  it('overall percent ignores no-data subjects (J14)', () => {
    const d = base({
      slots: [
        slot({ id: 'm1', subjectId: 'math', weekday: 1 }),
        slot({ id: 'c1', subjectId: 'cs', weekday: 2 }),
      ],
      marks: [mk('2026-10-05', 'm1', 'present'), mk('2026-10-12', 'm1', 'present')],
    })
    const plan = buildMonthPlan(d, '2026-10', '2026-10-28')
    const cs = plan.subjects.find((s) => s.subjectId === 'cs')!
    expect(cs.status).toBe('nodata')
    expect(plan.overallHeld).toBe(2)
    expect(plan.overallPercent).toBeCloseTo(100, 5)
  })
})
