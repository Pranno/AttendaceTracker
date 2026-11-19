// End to end: real timetable PDF (as pdf.js extracts it) → parser → batch
// filter → save → what Today / the Calendar show on each day of a week.
import { describe, expect, it } from 'vitest'
import wordLevel from './__fixtures__/timetable-divA.json'
import runLevel from './__fixtures__/tt-divA.json'
import divC from './__fixtures__/tt-divC.json'
import divF from './__fixtures__/tt-divF.json'
import type { AppData } from '../data/model'
import { DEFAULT_SETTINGS, EMPTY_DATA } from '../data/model'
import type { TextItemLike } from './pdfText'
import { filterByBatch, parseTimetablePages } from './timetableImport'
import { applyImport } from './applyImport'
import { slotsForDate } from './attendance'
import { timetableFromAnswer } from './smartImport'

const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'] // Mon–Sat
const TODAY = '2026-11-19'

function importInto(pages: unknown, batch: string, data?: AppData): AppData {
  const res = parseTimetablePages(pages as TextItemLike[][])
  const mine = filterByBatch(res.entries, batch)
  const base: AppData = data ?? {
    ...structuredClone(EMPTY_DATA),
    settings: { ...DEFAULT_SETTINGS, myBatch: batch, semesterStart: '2026-08-03' },
  }
  const out = applyImport(base, mine, res.subjects, TODAY)
  return { ...base, subjects: out.subjects, slots: [...base.slots, ...out.newSlots] }
}

/** What the day screen shows: "08:00-10:00 FE lab" per class, in order. */
function day(d: AppData, date: string): string[] {
  return slotsForDate(d, date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((s) => `${s.startTime}-${s.endTime} ${d.subjects.find((x) => x.id === s.subjectId)?.shortName} ${s.type}`)
}

/** Div A, batch A1, as printed (2-period labs = one class). */
const DIV_A_A1: Record<string, string[]> = {
  '2026-11-16': ['08:00-10:00 FE lab', '10:15-11:15 IKS lecture', '11:15-12:15 WAD lecture', '12:15-14:15 ASEP lab'],
  '2026-11-17': ['08:00-09:00 FE lecture', '09:00-10:00 SDC lecture', '10:15-12:15 CP lab', '13:15-14:15 CP lecture'],
  '2026-11-18': ['09:00-10:00 CP lecture', '10:15-11:15 CP lecture', '12:15-14:15 WAD lab'],
  '2026-11-19': ['08:00-09:00 SDC lecture', '09:00-10:00 FE lecture', '10:15-11:15 SDC tutorial'],
  '2026-11-20': ['08:00-09:00 SDC lecture', '09:00-10:00 VACO-I lecture', '10:15-11:15 FE lecture', '12:15-14:15 ASEP lab'],
  '2026-11-21': ['14:15-15:15 ASEP lab'],
}

describe('timetable import end to end (Div A, batch A1)', () => {
  for (const [name, pages] of [['word-level PDF', wordLevel], ['run-level PDF', runLevel]] as const) {
    it(`${name}: every day shows exactly the printed classes`, () => {
      const d = importInto(pages, 'A1')
      for (const date of WEEK) expect(day(d, date), date).toEqual(DIV_A_A1[date])
    })
  }

  it('classes also show on past days (from the semester start) and full names are set', () => {
    const d = importInto(runLevel, 'A1')
    expect(day(d, '2026-08-03')).toEqual(DIV_A_A1['2026-11-16']) // first Monday of the semester
    expect(day(d, '2026-08-02')).toEqual([]) // the day before the semester starts
    const names = Object.fromEntries(d.subjects.map((s) => [s.shortName, s.fullName]))
    expect(names.CP).toBe('Computer Programming')
    expect(names['VACO-I']).toBe('Value added career orientation I')
  })

  it('other batches never appear; batch A2 sees its own labs', () => {
    const a2 = importInto(runLevel, 'A2')
    expect(day(a2, '2026-11-16')).toEqual(['08:00-10:00 WAD lab', '10:15-11:15 IKS lecture', '11:15-12:15 WAD lecture', '12:15-14:15 ASEP lab'])
  })

  it('importing the same timetable twice does not double the classes', () => {
    const once = importInto(runLevel, 'A1')
    const twice = importInto(runLevel, 'A1', once)
    expect(twice.slots.length).toBe(once.slots.length)
    for (const date of WEEK) expect(day(twice, date)).toEqual(DIV_A_A1[date])
  })
})

describe('other divisions import cleanly', () => {
  for (const [name, pages, batch] of [['Div C', divC, 'C1'], ['Div F', divF, 'F1']] as const) {
    it(`${name} ${batch}: every parsed class is on its day, once, nothing overlapping`, () => {
      const res = parseTimetablePages(pages as unknown as TextItemLike[][])
      const mine = filterByBatch(res.entries, batch)
      const d = importInto(pages, batch)
      for (let wd = 1; wd <= 6; wd++) {
        const shown = slotsForDate(d, WEEK[wd - 1]).sort((a, b) => a.startTime.localeCompare(b.startTime))
        // every parsed class of that weekday is covered by a shown class
        for (const e of mine.filter((x) => x.weekday === wd)) {
          const covered = shown.some(
            (s) => d.subjects.find((x) => x.id === s.subjectId)?.shortName === e.subjectShort.toUpperCase() &&
              s.startTime <= e.startTime && e.endTime <= s.endTime,
          )
          expect(covered, `${name} wd${wd} ${e.startTime} ${e.subjectShort}`).toBe(true)
        }
        // no two classes of MY batch overlap in time
        for (let i = 1; i < shown.length; i++) {
          expect(shown[i].startTime >= shown[i - 1].endTime, `${name} wd${wd} overlap ${shown[i - 1].startTime}/${shown[i].startTime}`).toBe(true)
        }
        for (const s of shown) expect(s.startTime >= '08:00' && s.endTime <= '18:30').toBe(true)
      }
    })
  }
})

describe('Smart (AI) import saves classes the same way', () => {
  it('Gemini-style answer → same days as the PDF reader', () => {
    const res = timetableFromAnswer({
      classes: [
        { day: 'Monday', start: '8:00', end: '10:00', subject: 'FE', type: 'lab', batch: 'A1', teacher: 'PS', room: '2408' },
        { day: 'Monday', start: '8:00', end: '10:00', subject: 'WAD', type: 'lab', batch: 'A2', teacher: 'YP', room: '2314' },
        { day: 'Monday', start: '10.15', end: '11.15', subject: 'IKS', type: 'lecture', batch: 'A' },
        { day: 'Tuesday', start: '1.15', end: '2.15', subject: 'CP', type: 'lecture', batch: '' },
      ],
      subjects: [{ code: 'FE', name: 'Fundamentals of Electronics' }],
    })
    const base: AppData = { ...structuredClone(EMPTY_DATA), settings: { ...DEFAULT_SETTINGS, myBatch: 'A1', semesterStart: '2026-08-03' } }
    const out = applyImport(base, filterByBatch(res.entries, 'A1'), res.subjects, TODAY)
    const d = { ...base, subjects: out.subjects, slots: out.newSlots }
    expect(day(d, '2026-11-16')).toEqual(['08:00-10:00 FE lab', '10:15-11:15 IKS lecture'])
    expect(day(d, '2026-11-17')).toEqual(['13:15-14:15 CP lecture'])
  })
})
