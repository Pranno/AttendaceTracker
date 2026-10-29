// Stretch #4: multi-semester archive — storage round-trip tests.
import { describe, it, expect, beforeEach } from 'vitest'
import type { ArchivedSemester } from '../data/storage'
import { saveArchive, listArchives, loadArchive, deleteArchive } from '../data/storage'
import { EMPTY_DATA } from '../data/model'

// Minimal in-memory localStorage stub (tests run in the node environment).
const store = new Map<string, string>()
const ls: Storage = {
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
;(globalThis as Record<string, unknown>).localStorage = ls

const entry = (id: string, label: string, archivedOn: string): ArchivedSemester => ({
  id,
  label,
  startDate: '2026-01-10',
  endDate: '2026-05-30',
  archivedOn,
  subjectNames: ['WAD', 'FE'],
  summary: ['WAD: 42/50 (84%)', 'FE: 30/32 (94%)'],
  data: structuredClone(EMPTY_DATA),
})

beforeEach(() => localStorage.clear())

describe('semester archive storage', () => {
  it('saves and loads a full snapshot back', () => {
    saveArchive(entry('a1', 'Sem 4', '2026-05-31'))
    const got = loadArchive('a1')
    expect(got).not.toBeNull()
    expect(got!.label).toBe('Sem 4')
    expect(got!.summary).toEqual(['WAD: 42/50 (84%)', 'FE: 30/32 (94%)'])
    expect(got!.data.subjects).toEqual([]) // EMPTY_DATA round-trips
  })

  it('lists newest first and skips corrupt entries', () => {
    saveArchive(entry('a1', 'older', '2026-05-31'))
    saveArchive(entry('a2', 'newer', '2026-12-31'))
    localStorage.setItem('attendancetracker.archive.v1.bad', '{not json')
    const all = listArchives()
    expect(all.map((a) => a.label)).toEqual(['newer', 'older'])
  })

  it('delete removes only that archive; missing id loads as null', () => {
    saveArchive(entry('a1', 'one', '2026-05-31'))
    saveArchive(entry('a2', 'two', '2026-06-01'))
    deleteArchive('a1')
    expect(loadArchive('a1')).toBeNull()
    expect(listArchives().map((a) => a.id)).toEqual(['a2'])
  })

  it('archives do not touch the active store key', () => {
    localStorage.setItem('attendancetracker.data.v1', 'ACTIVE')
    saveArchive(entry('a1', 'Sem 4', '2026-05-31'))
    expect(localStorage.getItem('attendancetracker.data.v1')).toBe('ACTIVE')
    deleteArchive('a1')
    expect(localStorage.getItem('attendancetracker.data.v1')).toBe('ACTIVE')
  })
})
