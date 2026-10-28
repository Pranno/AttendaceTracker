// App-wide state: loads from storage, saves on every change (so the timetable
// and marks are still there after closing and reopening the app).

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData, DateStr, MarkStatus, Slot, Subject, Deadline } from '../data/model'
import { newId } from '../data/model'
import { loadData, saveData, clearData } from '../data/storage'
import { markFor } from '../logic/attendance'

interface AppApi {
  data: AppData
  setData: (updater: (d: AppData) => AppData) => void
  // ---- subjects & timetable (A6, A10) ----
  addSubject: (shortName: string, fullName: string) => Subject
  removeSubject: (id: string) => void
  addSlot: (slot: Omit<Slot, 'id'>) => void
  updateSlot: (id: string, patch: Partial<Slot>) => void
  /** A8: removing a class applies from today onward; past keeps what it had. */
  removeSlotFromToday: (id: string, today: DateStr) => void
  // ---- attendance marking (B1) ----
  setMark: (date: DateStr, slotId: string, status: MarkStatus | null) => void
  // ---- deadlines (C5 minimal for step 1) ----
  addDeadline: (d: Omit<Deadline, 'id' | 'reminderDates' | 'done' | 'tentative'>) => void
  toggleDeadlineDone: (id: string) => void
  deleteDeadline: (id: string) => void
  // ---- settings ----
  updateSettings: (patch: Partial<AppData['settings']>) => void
  resetAll: () => void
}

const Ctx = createContext<AppApi | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setRaw] = useState<AppData>(() => loadData())

  useEffect(() => {
    saveData(data)
  }, [data])

  const api = useMemo<AppApi>(() => {
    const setData = (updater: (d: AppData) => AppData) => setRaw((d) => updater(d))

    return {
      data,
      setData,

      addSubject(shortName, fullName) {
        const subj: Subject = {
          id: newId('subj'),
          shortName,
          fullName,
          nicknames: [],
        }
        setRaw((d) => ({ ...d, subjects: [...d.subjects, subj] }))
        return subj
      },

      removeSubject(id) {
        setRaw((d) => {
          const slotIds = d.slots.filter((s) => s.subjectId === id).map((s) => s.id)
          return {
            ...d,
            subjects: d.subjects.filter((s) => s.id !== id),
            slots: d.slots.filter((s) => s.subjectId !== id),
            marks: d.marks.filter((m) => !slotIds.includes(m.slotId)),
          }
        })
      },

      addSlot(slot) {
        setRaw((d) => ({ ...d, slots: [...d.slots, { ...slot, id: newId('slot') }] }))
      },

      updateSlot(id, patch) {
        setRaw((d) => ({ ...d, slots: d.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
      },

      removeSlotFromToday(id, today) {
        // Keep history: end validity at yesterday rather than deleting.
        setRaw((d) => ({
          ...d,
          slots: d.slots.map((s) =>
            s.id === id ? { ...s, validUntil: today } : s,
          ),
        }))
      },

      setMark(date, slotId, status) {
        setRaw((d) => {
          const marks = d.marks.filter((m) => !(m.date === date && m.slotId === slotId))
          if (status !== null) marks.push({ id: `${date}_${slotId}`, date, slotId, status })
          return { ...d, marks }
        })
      },

      addDeadline(dl) {
        setRaw((d) => ({
          ...d,
          deadlines: [
            ...d.deadlines,
            { ...dl, id: newId('dl'), done: false, tentative: false, reminderDates: [] },
          ],
        }))
      },

      toggleDeadlineDone(id) {
        setRaw((d) => ({
          ...d,
          deadlines: d.deadlines.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
        }))
      },

      deleteDeadline(id) {
        // Data rule: deleting a deadline cancels its scheduled notifications —
        // on web there is nothing to cancel yet; Capacitor step will hook in here.
        setRaw((d) => ({ ...d, deadlines: d.deadlines.filter((x) => x.id !== id) }))
      },

      updateSettings(patch) {
        setRaw((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
      },

      resetAll() {
        clearData()
        setRaw(loadData())
      },
    }
  }, [data])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useApp(): AppApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

/** Convenience: current mark of a slot on a date. */
export function getMark(data: AppData, date: DateStr, slotId: string): MarkStatus | null {
  return markFor(data, date, slotId)
}
