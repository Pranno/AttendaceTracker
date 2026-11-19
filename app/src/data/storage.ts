// Storage: one file behind which the app stores everything (Architecture table).
// Step 1 uses browser localStorage; Capacitor app storage plugs in here later.

import type { AppData } from '../data/model'
import { EMPTY_DATA, DEFAULT_SETTINGS } from '../data/model'

const KEY = 'attendancetracker.data.v1'

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(EMPTY_DATA)
    return normalizeData(JSON.parse(raw) as Partial<AppData>)
  } catch {
    return structuredClone(EMPTY_DATA)
  }
}

/** Merge saved/archived data over the defaults so fields added in later app
 *  versions exist (older snapshots would otherwise crash on `undefined`). */
export function normalizeData(parsed: Partial<AppData> | null | undefined): AppData {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    ...structuredClone(EMPTY_DATA),
    ...p,
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
  }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch (err) {
    // Storage full / unavailable (private mode): keep the app running with
    // the in-memory state instead of crashing the render.
    console.warn('Could not save app data', err)
  }
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
  // Firefox only follows clicks on attached anchors, and revoking the URL in
  // the same tick can cancel the download before it starts (Safari/Firefox).
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
