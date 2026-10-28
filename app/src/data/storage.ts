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
