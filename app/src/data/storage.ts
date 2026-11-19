// Storage: one file behind which the app stores everything (Architecture table).
// Step 1 uses browser localStorage; Capacitor app storage plugs in here later.

import type { AppData } from '../data/model'
import { EMPTY_DATA, DEFAULT_SETTINGS } from '../data/model'
import { saveGeneratedFile } from '../logic/nativeFiles'

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
  return repairTimetable({
    ...structuredClone(EMPTY_DATA),
    ...p,
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
  })
}

/** Safe one-way repairs for timetables saved by older versions:
 *  1. Afternoon classes stored as morning times (an old parser bug read
 *     "1.15 - 2.15" as 01:15-02:15). No college class runs between 1 and 7
 *     in the morning, so those hours move to the afternoon.
 *  2. Exact duplicate classes (importing the same timetable twice used to
 *     add every class again — shown twice, counted twice). Duplicates are
 *     merged and their attendance marks moved onto the kept class. */
export function repairTimetable(d: AppData): AppData {
  if (!Array.isArray(d.slots) || d.slots.length === 0) return d
  let changed = false
  const pm = (t: string): string => {
    const m = /^(\d{2}):(\d{2})$/.exec(t ?? '')
    if (!m) return t
    const h = Number(m[1])
    return h >= 1 && h <= 6 ? `${String(h + 12).padStart(2, '0')}:${m[2]}` : t
  }
  let slots = d.slots.map((s) => {
    const startTime = pm(s.startTime)
    const endTime = pm(s.endTime)
    if (startTime === s.startTime && endTime === s.endTime) return s
    changed = true
    return { ...s, startTime, endTime }
  })
  const key = (s: (typeof slots)[number]) =>
    [s.subjectId, s.weekday, s.startTime, s.endTime, s.type, s.batch ?? '', s.validFrom, s.validUntil ?? ''].join('|')
  const keep = new Map<string, string>() // key → kept slot id
  const alias = new Map<string, string>() // dropped id → kept id
  slots = slots.filter((s) => {
    const k = key(s)
    const kept = keep.get(k)
    if (kept === undefined) {
      keep.set(k, s.id)
      return true
    }
    alias.set(s.id, kept)
    return false
  })
  let marks = d.marks
  let conversions = d.conversions
  if (alias.size > 0) {
    changed = true
    const seen = new Set<string>()
    marks = []
    // marks on the kept class win; a duplicate's mark fills in only where the kept one has none
    const ordered = [...d.marks.filter((m) => !alias.has(m.slotId)), ...d.marks.filter((m) => alias.has(m.slotId))]
    for (const m of ordered) {
      const slotId = alias.get(m.slotId) ?? m.slotId
      const k = `${m.date}|${slotId}`
      if (seen.has(k)) continue
      seen.add(k)
      marks.push(slotId === m.slotId ? m : { ...m, slotId, id: `${m.date}_${slotId}` })
    }
    conversions = (d.conversions ?? []).map((c) => (alias.has(c.slotId) ? { ...c, slotId: alias.get(c.slotId)! } : c))
  }
  return changed ? { ...d, slots, marks, conversions } : d
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
export async function exportData(data: AppData): Promise<void> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // Browser: normal download. Android app: the WebView ignores download
  // links (Export used to do nothing there), so it opens the share sheet.
  await saveGeneratedFile(blob, `attendance-tracker-${stamp}.json`, 'application/json')
}

/** F7b: Restore from an exported backup file. Validates the shape before
 *  anything is replaced, so a wrong or damaged file can't wipe the app. */
export function parseBackup(text: string): AppData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not a valid backup (it is not JSON).')
  }
  const o = raw as Partial<AppData> | null
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('That file is not an Attendance Tracker backup.')
  if (o.version !== undefined && o.version !== 1) throw new Error('This backup is from a newer, unsupported version of the app.')
  const arrays: (keyof AppData)[] = ['subjects', 'slots', 'marks', 'holidays', 'deadlines']
  for (const k of arrays) {
    if (o[k] !== undefined && !Array.isArray(o[k])) throw new Error(`That backup is damaged (“${k}” is not a list).`)
  }
  if (!Array.isArray(o.subjects) || !Array.isArray(o.slots)) {
    throw new Error('That file is not an Attendance Tracker backup (no subjects or timetable in it).')
  }
  if (o.settings !== undefined && (typeof o.settings !== 'object' || o.settings === null)) {
    throw new Error('That backup is damaged (settings are unreadable).')
  }
  return normalizeData(o)
}
