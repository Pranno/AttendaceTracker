// Storage: one file behind which the app stores everything (Architecture table).
// Step 1 uses browser localStorage; Capacitor app storage plugs in here later.

import type { AppData } from '../data/model'
import { EMPTY_DATA, DEFAULT_SETTINGS } from '../data/model'

const KEY = 'attendancetracker.data.v1'

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(EMPTY_DATA)
    const parsed = JSON.parse(raw) as Partial<AppData>
    // Merge so new fields get defaults after an app update.
    return {
      ...structuredClone(EMPTY_DATA),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    }
  } catch {
    return structuredClone(EMPTY_DATA)
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function clearData(): void {
  localStorage.removeItem(KEY)
}

// ---- Stretch #4: Multi-semester archive ----
// When a semester ends you can archive it and start fresh. The snapshot is
// kept under its own key so the active store stays small; archived semesters
// are read-only (totals + per-subject attendance) until restored.

const ARCHIVE_PREFIX = 'attendancetracker.archive.v1.'

export interface ArchivedSemester {
  id: string
  label: string
  startDate: string | null
  endDate: string | null
  archivedOn: string
  /** Which subjects were archived with this semester (for display). */
  subjectNames: string[]
  /** Attendance totals at archive time, e.g. "WAD: 42/50 (84%)". */
  summary: string[]
  /** The complete AppData snapshot — restoring puts everything back. */
  data: AppData
}

export function listArchives(): ArchivedSemester[] {
  const out: ArchivedSemester[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(ARCHIVE_PREFIX)) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      try {
        out.push(JSON.parse(raw) as ArchivedSemester)
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return out.sort((a, b) => b.archivedOn.localeCompare(a.archivedOn))
}

export function saveArchive(entry: ArchivedSemester): void {
  localStorage.setItem(ARCHIVE_PREFIX + entry.id, JSON.stringify(entry))
}

export function deleteArchive(id: string): void {
  localStorage.removeItem(ARCHIVE_PREFIX + id)
}

export function loadArchive(id: string): ArchivedSemester | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_PREFIX + id)
    return raw ? (JSON.parse(raw) as ArchivedSemester) : null
  } catch {
    return null
  }
}

/** F7: Export my data — download the whole store as a JSON file. */
export function exportData(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance-tracker-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
