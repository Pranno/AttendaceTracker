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
