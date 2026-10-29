// App-wide state: loads from storage, saves on every change (so the timetable
// and marks are still there after closing and reopening the app).

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData, DateStr, Holiday, MarkStatus, Slot, Subject, Deadline, Unit, Topic, PracticeQuestion } from '../data/model'
import { newId } from '../data/model'
import { loadData, saveData, clearData } from '../data/storage'
import { markFor } from '../logic/attendance'
import { scheduleDeadlineNotification, cancelDeadlineNotification, resyncAllNotifications } from '../logic/reminders'

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
  addDeadline: (d: Omit<Deadline, 'id' | 'reminderDates' | 'done' | 'tentative'> & { tentative?: boolean }) => void
  updateDeadline: (id: string, patch: Partial<Deadline>) => void
  toggleDeadlineDone: (id: string) => void
  deleteDeadline: (id: string) => void
  // ---- holidays / exam days (A12) ----
  addHoliday: (h: Omit<Holiday, 'id'>) => void
  updateHoliday: (id: string, patch: Partial<Holiday>) => void
  deleteHoliday: (id: string) => void
  // ---- study units & topics (E-series) ----
  addUnit: (u: Omit<Unit, 'id' | 'topics'> & { topics?: Topic[] }) => void
  updateUnit: (id: string, patch: Partial<Unit>) => void
  deleteUnit: (id: string) => void
  upsertTopic: (unitId: string, topic: Topic) => void
  removeTopic: (unitId: string, name: string) => void
  /** E3/E4: tick a unit or one of its topics as revised on `date`. */
  markRevised: (unitId: string, topicName: string | null, date: DateStr) => void
  /** E10: add a practice question to a unit. */
  addQuestion: (unitId: string, q: Omit<PracticeQuestion, 'id'>) => void
  updateQuestion: (unitId: string, q: PracticeQuestion) => void
  removeQuestion: (unitId: string, qid: string) => void
  // ---- focus sessions (E9 timer log) ----
  addFocusSession: (date: DateStr, minutes: number, kind: 'study' | 'project' | 'break') => void
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
        let created: Deadline | null = null
        setRaw((d) => {
          const item: Deadline = { reminderDates: [], tentative: false, ...dl, id: newId('dl'), done: false }
          created = item
          return { ...d, deadlines: [...d.deadlines, item] }
        })
        // D6: on native, arm the OS notification immediately (no-op on web).
        if (created) {
          void scheduleDeadlineNotification(created, data.settings.reminderLeadDays, data.settings.notificationTime)
        }
      },

      updateDeadline(id, patch) {
        // D7: an edit replaces the old scheduled reminder.
        void cancelDeadlineNotification(id)
        setRaw((d) => ({
          ...d,
          deadlines: d.deadlines.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }))
        const after = { ...data.deadlines.find((x) => x.id === id), ...patch } as Deadline | undefined
        if (after?.id && !after.done) {
          void scheduleDeadlineNotification(after, data.settings.reminderLeadDays, data.settings.notificationTime)
        }
      },

      toggleDeadlineDone(id) {
        setRaw((d) => ({
          ...d,
          deadlines: d.deadlines.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
        }))
        const was = data.deadlines.find((x) => x.id === id)
        if (was && !was.done) void cancelDeadlineNotification(id) // now done → cancel reminder
      },

      deleteDeadline(id) {
        // Data rule (D7): deleting a deadline cancels its scheduled notifications.
        void cancelDeadlineNotification(id)
        setRaw((d) => ({ ...d, deadlines: d.deadlines.filter((x) => x.id !== id) }))
      },

      addHoliday(h) {
        setRaw((d) => ({ ...d, holidays: [...d.holidays, { ...h, id: newId('hol') }] }))
      },

      updateHoliday(id, patch) {
        setRaw((d) => ({ ...d, holidays: d.holidays.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
      },

      deleteHoliday(id) {
        setRaw((d) => ({ ...d, holidays: d.holidays.filter((x) => x.id !== id) }))
      },

      addUnit(u) {
        setRaw((d) => ({
          ...d,
          units: [...d.units, { ...u, topics: u.topics ?? [], id: newId('unit') }],
        }))
      },

      updateUnit(id, patch) {
        setRaw((d) => ({ ...d, units: d.units.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
      },

      deleteUnit(id) {
        setRaw((d) => ({ ...d, units: d.units.filter((x) => x.id !== id) }))
      },

      upsertTopic(unitId, topic) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) => {
            if (u.id !== unitId) return u
            const exists = u.topics.some((t) => t.name === topic.name)
            const topics = exists
              ? u.topics.map((t) => (t.name === topic.name ? topic : t))
              : [...u.topics, topic]
            return { ...u, topics }
          }),
        }))
      },

      removeTopic(unitId, name) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) => (u.id === unitId ? { ...u, topics: u.topics.filter((t) => t.name !== name) } : u)),
        }))
      },

      markRevised(unitId, topicName, date) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) => {
            if (u.id !== unitId) return u
            if (topicName === null) {
              // E3: whole unit revised — tick every topic too.
              return { ...u, revisedDate: date, topics: u.topics.map((t) => ({ ...t, revisedDate: t.revisedDate ?? date })) }
            }
            const topics = u.topics.map((t) => (t.name === topicName ? { ...t, revisedDate: date } : t))
            const allDone = topics.length > 0 && topics.every((t) => t.revisedDate)
            return { ...u, topics, revisedDate: allDone ? u.revisedDate ?? date : u.revisedDate }
          }),
        }))
      },

      addQuestion(unitId, q) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) =>
            u.id === unitId ? { ...u, questions: [...(u.questions ?? []), { ...q, id: newId('q') }] } : u,
          ),
        }))
      },

      updateQuestion(unitId, q) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) =>
            u.id === unitId ? { ...u, questions: (u.questions ?? []).map((x) => (x.id === q.id ? q : x)) } : u,
          ),
        }))
      },

      removeQuestion(unitId, qid) {
        setRaw((d) => ({
          ...d,
          units: d.units.map((u) =>
            u.id === unitId ? { ...u, questions: (u.questions ?? []).filter((x) => x.id !== qid) } : u,
          ),
        }))
      },

      addFocusSession(date, minutes, kind) {
        setRaw((d) => ({ ...d, focusSessions: [...d.focusSessions, { id: newId('fs'), date, minutes, kind }] }))
      },

      updateSettings(patch) {
        setRaw((d) => {
          const next = { ...d, settings: { ...d.settings, ...patch } }
          // D7: when reminder lead time or arrival time change, re-arm every
          // native scheduled notification with the new timing.
          if (
            (patch.reminderLeadDays !== undefined && patch.reminderLeadDays !== d.settings.reminderLeadDays) ||
            (patch.notificationTime !== undefined && patch.notificationTime !== d.settings.notificationTime)
          ) {
            void resyncAllNotifications(next)
          }
          return next
        })
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
