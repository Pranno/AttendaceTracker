import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../data/model'
import { DEFAULT_SETTINGS, EMPTY_DATA } from '../data/model'
import { plannedEveningNudges, plannedTomorrowPlans } from './reminders'

// Thursday 2026-11-19, 09:00 local. Classes Mon–Fri at 10:00.
const NOW = new Date(2026, 10, 19, 9, 0)

function makeData(): AppData {
  return {
    ...structuredClone(EMPTY_DATA),
    settings: { ...DEFAULT_SETTINGS, eveningReminderOn: true, eveningReminderTime: '20:00', notificationTime: '18:00', semesterStart: '2026-11-01' },
    subjects: [{ id: 's1', shortName: 'CP', fullName: 'Computer Programming', nicknames: [] }],
    slots: [1, 2, 3, 4, 5].map((wd) => ({
      id: `sl${wd}`, subjectId: 's1', weekday: wd, startTime: '10:00', endTime: '11:00',
      type: 'lecture' as const, room: '', teacher: '', validFrom: '2026-11-01', validUntil: null,
    })),
  }
}

describe('daily notifications are one-shot per day', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('evening nudge only on class days that still have something unmarked', () => {
    const d = makeData()
    // today (Thu 19) fully marked; Fri 20 is a holiday
    d.marks.push({ id: 'm', date: '2026-11-19', slotId: 'sl4', status: 'present' })
    d.holidays.push({ id: 'h', startDate: '2026-11-20', endDate: '2026-11-20', label: 'Fest', isExamDay: false })
    const days = plannedEveningNudges(d, NOW).map((n) => n.at.getDate())
    // 19 marked, 20 holiday, 21/22 weekend → next is Mon 23
    expect(days).toEqual([23, 24, 25])
    expect(new Set(plannedEveningNudges(d, NOW).map((n) => n.id)).size).toBe(3)
  })

  it('evening nudge off → nothing scheduled', () => {
    const d = makeData()
    d.settings.eveningReminderOn = false
    expect(plannedEveningNudges(d, NOW)).toHaveLength(0)
  })

  it("tomorrow's plan fires the evening BEFORE a class day only", () => {
    const d = makeData()
    d.holidays.push({ id: 'h', startDate: '2026-11-23', endDate: '2026-11-23', label: 'Off', isExamDay: false })
    // Tue 24's class already marked "No class" in advance
    d.marks.push({ id: 'm', date: '2026-11-24', slotId: 'sl2', status: 'noclass' })
    const plans = plannedTomorrowPlans(d, NOW)
    // Thu 19 (→ Fri), Tue 24 (→ Wed), Wed 25 (→ Thu). Not Fri/Sat (weekend next),
    // not Sun (→ holiday Mon), not Mon (→ Tue already no-class).
    expect(plans.map((p) => p.at.getDate())).toEqual([19, 24, 25])
    for (const p of plans) expect(p.at.getHours()).toBe(18)
  })
})
