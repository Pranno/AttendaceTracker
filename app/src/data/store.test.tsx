// Regression tests for the store: hand-added lectures must never make
// previously imported/added classes disappear from past days.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Must be set before react-dom is loaded so act() works correctly.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { AppProvider, useApp } from './store'

/** Minimal renderHook stand-in (no extra dev dependency needed). */
function renderHook<T>(hookFn: () => T) {
  const result = { current: undefined as unknown as T }
  let root!: Root
  function Harness() {
    result.current = hookFn()
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    root = createRoot(host)
    root.render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    )
  })
  return {
    result,
    cleanup: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

beforeAll(() => {
  // Keep every test isolated in localStorage (the store persists on change).
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
})

afterEach(() => {
  localStorage.clear()
})

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('addSlot keeps the timetable intact (bug: hand-added lectures vanishing)', () => {
  it('backdates validFrom so older slots still show on past days and the new one appears too', () => {
    const { result } = renderHook(() => useApp())
    const today = todayStr()

    // Simulate a PDF import: an existing slot whose validFrom is "today"
    // (that's what confirmImport stamps), plus its subject.
    act(() => {
      result.current.setData((d) => ({
        ...d,
        subjects: [{ id: 'sub1', shortName: 'MATH', fullName: 'Mathematics', nicknames: [] }],
        slots: [
          {
            id: 'slot-imp', subjectId: 'sub1', weekday: 2, startTime: '09:00', endTime: '10:00',
            type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
          },
        ],
      }))
    })

    // User hand-adds a Mon+Fri lecture (two addSlot calls, like submitLecture does).
    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 1, startTime: '12:15', endTime: '14:15',
      type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
    }))
    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 5, startTime: '12:15', endTime: '14:15',
      type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
    }))

    // Then adds Tuesday/Wednesday lectures afterwards.
    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 2, startTime: '10:00', endTime: '11:00',
      type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
    }))
    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 3, startTime: '11:00', endTime: '12:00',
      type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
    }))

    const slots = result.current.data.slots
    expect(slots).toHaveLength(5) // nothing disappeared

    // Every hand-added slot got backdated to the earliest existing validFrom,
    // so past days keep showing ALL classes (imported + hand-added alike).
    for (const s of slots) {
      expect(s.validFrom).toBe(today)
    }

    // The Mon/Fri lectures are still there with their times.
    const monFri = slots.filter((s) => s.weekday === 1 || s.weekday === 5)
    expect(monFri).toHaveLength(2)
    expect(monFri.every((s) => s.startTime === '12:15')).toBe(true)
  })

  it('honours semesterStart as the floor when set', () => {
    const { result } = renderHook(() => useApp())
    const today = todayStr()

    act(() => {
      result.current.setData((d) => ({
        ...d,
        settings: { ...d.settings, semesterStart: '2026-01-05' },
        subjects: [{ id: 'sub1', shortName: 'PHY', fullName: 'Physics', nicknames: [] }],
      }))
    })

    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 1, startTime: '09:00', endTime: '10:00',
      type: 'lecture', room: '', teacher: '', validFrom: today, validUntil: null,
    }))

    const s = result.current.data.slots[0]
    expect(s.validFrom).toBe('2026-01-05')
  })

  it('does not move a slot whose validFrom is already earlier than the floor', () => {
    const { result } = renderHook(() => useApp())

    act(() => {
      result.current.setData((d) => ({
        ...d,
        settings: { ...d.settings, semesterStart: '2026-02-01' },
        subjects: [{ id: 'sub1', shortName: 'CHE', fullName: 'Chemistry', nicknames: [] }],
      }))
    })

    act(() => result.current.addSlot({
      subjectId: 'sub1', weekday: 3, startTime: '09:00', endTime: '10:00',
      type: 'lecture', room: '', teacher: '', validFrom: '2026-01-10', validUntil: null,
    }))

    expect(result.current.data.slots[0].validFrom).toBe('2026-01-10')
  })
})

describe('semester dates keep timetable versions', () => {
  it('backdates first versions only — a replacement slot keeps its own start', () => {
    const { result, cleanup } = renderHook(() => useApp())
    const base = { subjectId: 'sub1', weekday: 1, endTime: '10:00', type: 'lecture' as const, room: '', teacher: '' }
    act(() => {
      result.current.setData((d) => ({
        ...d,
        subjects: [{ id: 'sub1', shortName: 'CP', fullName: 'CP', nicknames: [] }],
        slots: [
          { ...base, id: 'old', startTime: '09:00', validFrom: '2026-09-01', validUntil: '2026-10-04' },
          { ...base, id: 'new', startTime: '09:00', validFrom: '2026-10-05', validUntil: null },
          { ...base, id: 'other', startTime: '11:00', endTime: '12:00', validFrom: '2026-09-01', validUntil: null },
        ],
      }))
    })
    act(() => result.current.updateSettings({ semesterStart: '2026-08-01', semesterEnd: '2026-12-31' }))
    const byId = Object.fromEntries(result.current.data.slots.map((s) => [s.id, s.validFrom]))
    expect(byId.old).toBe('2026-08-01')
    expect(byId.other).toBe('2026-08-01')
    expect(byId.new).toBe('2026-10-05') // used to be moved back and overlap "old"
    cleanup()
  })
})

describe('removeSubject cleans up everything that belonged to it', () => {
  it('drops its units, scores, course links and deadlines; keeps other subjects\' data', () => {
    const { result, cleanup } = renderHook(() => useApp())
    act(() => {
      result.current.setData((d) => ({
        ...d,
        subjects: [
          { id: 'a', shortName: 'CP', fullName: 'CP', nicknames: [] },
          { id: 'b', shortName: 'FE', fullName: 'FE', nicknames: [] },
        ],
        units: [
          { id: 'u1', subjectId: 'a', title: 'U1', topics: [] } as never,
          { id: 'u2', subjectId: 'b', title: 'U2', topics: [] } as never,
        ],
        scores: [{ id: 's1', subjectId: 'a' } as never, { id: 's2', subjectId: 'b' } as never],
        deadlines: [
          { id: 'd1', title: 'CP lab', dueDate: '2026-12-01', subjectId: 'a', reminderDates: [], done: false, tentative: false },
          { id: 'd2', title: 'General', dueDate: '2026-12-01', reminderDates: [], done: false, tentative: false },
        ],
      }))
    })
    act(() => result.current.removeSubject('a'))
    const d = result.current.data
    expect(d.units.map((u) => u.id)).toEqual(['u2'])
    expect(d.scores.map((x) => x.id)).toEqual(['s2'])
    expect(d.deadlines.map((x) => x.id)).toEqual(['d2'])
    cleanup()
  })
})

describe('Locker notes', () => {
  it('adds, edits, pins and deletes notes; removing the subject removes its notes', () => {
    const { result, cleanup } = renderHook(() => useApp())
    act(() => {
      result.current.setData((d) => ({
        ...d,
        subjects: [
          { id: 'a', shortName: 'CP', fullName: 'CP', nicknames: [] },
          { id: 'b', shortName: 'FE', fullName: 'FE', nicknames: [] },
        ],
      }))
    })
    act(() => result.current.addNote('a', '  Bring lab file  '))
    act(() => result.current.addNote('a', '   ')) // blank → ignored
    act(() => result.current.addNote('b', 'FE note'))
    expect(result.current.data.notes.map((n) => n.text)).toEqual(['Bring lab file', 'FE note'])
    const id = result.current.data.notes[0].id
    act(() => result.current.updateNote(id, { text: 'Bring lab file + viva', pinned: true }))
    const n = result.current.data.notes.find((x) => x.id === id)!
    expect(n.text).toBe('Bring lab file + viva')
    expect(n.pinned).toBe(true)
    expect(n.editedAt).toBeTruthy()
    act(() => result.current.removeSubject('a'))
    expect(result.current.data.notes.map((x) => x.text)).toEqual(['FE note'])
    act(() => result.current.deleteNote(result.current.data.notes[0].id))
    expect(result.current.data.notes).toHaveLength(0)
    cleanup()
  })
})
