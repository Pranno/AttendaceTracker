import { it, expect } from 'vitest'
import type { AppData, Slot, Subject } from '../data/model'
import { DEFAULT_SETTINGS, EMPTY_DATA } from '../data/model'
import { slotsForDate } from './attendance'

it('repro2', () => {
  const maths: Subject = { id: 'subj_maths', shortName: 'Maths', fullName: 'Mathematics', nicknames: [] }
  const d: AppData = { ...structuredClone(EMPTY_DATA), subjects: [maths], settings: { ...DEFAULT_SETTINGS, threshold: 80, semesterStart: '2026-08-01', semesterEnd: '2026-12-31', assumedPastAttendance: 80 } }
  const slots: Slot[] = []
  for (let i = 0; i < 5; i++) for (const wd of [1, 2, 3, 4, 5]) slots.push({ id: `sl_${wd}_${i}`, subjectId: 'subj_maths', weekday: wd, startTime: `0${8 + i}:00`, endTime: `0${9 + i}:00`, type: 'lecture', room: '101', teacher: 'Prof M', validFrom: '2026-11-01', validUntil: '2026-11-27' })
  d.slots = slots
  console.log('slots len:', d.slots.length)
  console.log('mon 2:', slotsForDate(d, '2026-11-02').length)
  console.log('tue 3:', slotsForDate(d, '2026-11-03').length)
  console.log('fri 6:', slotsForDate(d, '2026-11-06').length)
  console.log('sat 7:', slotsForDate(d, '2026-11-07').length)
  console.log('sun 8:', slotsForDate(d, '2026-11-08').length)
  expect(true).toBe(true)
})
