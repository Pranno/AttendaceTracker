// App-wide state: loads from storage, saves on every change (so the timetable
// and marks are still there after closing and reopening the app).

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData, CourseLink, DateStr, Holiday, MarkStatus, Slot, Subject, Deadline, Suggestion, Unit, Topic, PracticeQuestion } from '../data/model'
import { mergeCourseLinks, newId } from '../data/model'
import { loadData, saveData, clearData, saveArchive, listArchives, deleteArchive, loadArchive } from '../data/storage'
import type { ArchivedSemester } from '../data/storage'
import { markFor, buildReport } from '../logic/attendance'
import { todayStr } from '../logic/dates'
import { scheduleDeadlineNotification, cancelDeadlineNotification, resyncAllNotifications } from '../logic/reminders'

interface AppApi {
  data: AppData
  setData: (updater: (d: AppData) => AppData) => void
  // ---- subjects & timetable (A6, A10) ----
  addSubject: (shortName: string, fullName: string) => Subject
  removeSubject: (id: string) => void
  /** F2 (Stretch): per-subject settings, e.g. thresholdOverride. Pass null to
   *  clear the override and fall back to the global threshold. */
  updateSubject: (id: string, patch: Partial<Omit<Subject, 'id'>> & { thresholdOverride?: number | null }) => void
  addSlot: (slot: Omit<Slot, 'id'>) => void
  updateSlot: (id: string, patch: Partial<Slot>) => void
  /** A8: removing a class applies from today onward; past keeps what it had. */
  removeSlotFromToday: (id: string, today: DateStr) => void
  // ---- attendance marking (B1) ----
  setMark: (date: DateStr, slotId: string, status: MarkStatus | null) => void
  // ---- converted lectures (Stretch #5: subject swap on a day) ----
  /** Record that on `date` the class in `slotId`'s period was really another
   *  subject's lecture. Attendance for that day then counts toward
   *  `subjectId`. Re-converting the same date+slot replaces the old record. */
  addConversion: (date: DateStr, slotId: string, subjectId: string, note?: string) => void
  removeConversion: (id: string) => void
  // ---- deadlines (C5 minimal for step 1) ----
  addDeadline: (d: Omit<Deadline, 'id' | 'reminderDates' | 'done' | 'tentative'> & { tentative?: boolean }, id?: string) => void
  updateDeadline: (id: string, patch: Partial<Deadline>) => void
  toggleDeadlineDone: (id: string) => void
  deleteDeadline: (id: string) => void
  // ---- holidays / exam days (A12) ----
  addHoliday: (h: Omit<Holiday, 'id'>) => void
  updateHoliday: (id: string, patch: Partial<Holiday>) => void
  deleteHoliday: (id: string) => void
  // ---- special course links (H-series) ----
  addCourseLink: (c: Omit<CourseLink, 'id'>) => CourseLink
  updateCourseLink: (id: string, patch: Partial<CourseLink>) => void
  deleteCourseLink: (id: string) => void
  /** H6: mark status with the date; completed sets completedDate too. */
  setCourseStatus: (id: string, status: CourseLink['status'], date: DateStr) => void
  /** H8: tick/untick "certificate submitted" with a date. */
  setCertificateSubmitted: (id: string, date: DateStr | null) => void
  /** H8: attach/detach course links to a deadline for progress display. */
  setDeadlineCourseLinks: (deadlineId: string, linkIds: string[]) => void
  /** H11: merge an imported batch of links, keeping status of existing ones. */
  importCourseLinks: (links: Omit<CourseLink, 'id'>[]) => void
  // ---- email suggestions (I-series) ----
  /** I3: append freshly parsed suggestions without duplicating message ids. */
  addSuggestions: (s: Suggestion[]) => void
  /** I4: accept a suggestion -> creates a real Deadline, marks it 'added'. */
  acceptSuggestion: (id: string) => void
  dismissSuggestion: (id: string) => void
  clearSeenSuggestions: () => void
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
  // ---- Stretch #4: multi-semester archive ----
  /** Snapshot the finished semester into storage and start a fresh app state. */
  archiveSemester: () => ArchivedSemester | null
  archivedSemesters: () => ArchivedSemester[]
  deleteArchived: (id: string) => void
  /** Put an archived snapshot back as the active data (and remove it from the archive). */
  restoreArchive: (id: string) => boolean
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

      updateSubject(id, patch) {
        setRaw((d) => ({
          ...d,
          subjects: d.subjects.map((s) => {
            if (s.id !== id) return s
            const next = { ...s, ...patch }
            // thresholdOverride: null means "clear it" (back to global threshold).
            if ('thresholdOverride' in patch && patch.thresholdOverride === null) delete next.thresholdOverride
            return next
          }),
        }))
      },

      removeSubject(id) {
        setRaw((d) => {
          const slotIds = d.slots.filter((s) => s.subjectId === id).map((s) => s.id)
          return {
            ...d,
            subjects: d.subjects.filter((s) => s.id !== id),
            slots: d.slots.filter((s) => s.subjectId !== id),
            marks: d.marks.filter((m) => !slotIds.includes(m.slotId)),
            // Stretch #5: conversions pointing at the removed subject/slots die too.
            conversions: d.conversions.filter((c) => c.subjectId !== id && !slotIds.includes(c.slotId)),
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

      addConversion(date, slotId, subjectId, note) {
        setRaw((d) => {
          // one conversion per date+slot; re-converting replaces the old one
          const rest = d.conversions.filter((c) => !(c.date === date && c.slotId === slotId))
          return { ...d, conversions: [...rest, { id: newId('conv'), date, slotId, subjectId, note }] }
        })
      },

      removeConversion(id) {
        setRaw((d) => ({ ...d, conversions: d.conversions.filter((c) => c.id !== id) }))
      },

      addDeadline(dl, id) {
        let created: Deadline | null = null
        setRaw((d) => {
          const item: Deadline = { reminderDates: [], tentative: false, ...dl, id: id ?? newId('dl'), done: false }
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

      addCourseLink(c) {
        const link: CourseLink = { ...c, id: newId('course') }
        setRaw((d) => ({ ...d, courseLinks: [...d.courseLinks, link] }))
        return link
      },

      updateCourseLink(id, patch) {
        setRaw((d) => ({
          ...d,
          courseLinks: d.courseLinks.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }))
      },

      deleteCourseLink(id) {
        // H8: also un-link the course from any deadline that referenced it.
        setRaw((d) => ({
          ...d,
          courseLinks: d.courseLinks.filter((x) => x.id !== id),
          deadlines: d.deadlines.map((dl) =>
            dl.courseLinkIds?.includes(id)
              ? { ...dl, courseLinkIds: dl.courseLinkIds.filter((x) => x !== id) }
              : dl,
          ),
        }))
      },

      setCourseStatus(id, status, date) {
        setRaw((d) => ({
          ...d,
          courseLinks: d.courseLinks.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status,
                  completedDate: status === 'completed' ? x.completedDate ?? date : undefined,
                }
              : x,
          ),
        }))
      },

      setCertificateSubmitted(id, date) {
        setRaw((d) => ({
          ...d,
          courseLinks: d.courseLinks.map((x) =>
            x.id === id ? { ...x, certificateSubmittedDate: date ?? undefined } : x,
          ),
        }))
      },

      // H8: attach/detach course links to a deadline ("WAD certificates: 6 of 10 done").
      setDeadlineCourseLinks(deadlineId, linkIds) {
        setRaw((d) => ({
          ...d,
          deadlines: d.deadlines.map((dl) =>
            dl.id === deadlineId
              ? { ...dl, courseLinkIds: linkIds.length > 0 ? linkIds : undefined }
              : dl,
          ),
        }))
      },

      importCourseLinks(links) {
        setRaw((d) => ({
          ...d,
          courseLinks: mergeCourseLinks(
            d.courseLinks,
            links.map((l) => ({ ...l, id: newId('course') })),
          ),
        }))
      },

      addSuggestions(s) {
        if (s.length === 0) return
        setRaw((d) => ({ ...d, suggestions: [...d.suggestions, ...s] }))
      },

      acceptSuggestion(id) {
        const sug = data.suggestions.find((x) => x.id === id)
        if (!sug || sug.status !== 'new' || !sug.date) return
        // I4: accepting turns the suggestion into a real deadline — same path as
        // manual add (including D6 native notification arming).
        this.addDeadline({
          title: sug.title,
          dueDate: sug.date,
          subjectId: sug.subjectId,
          sourceText: sug.sourceSnippet,
        })
        setRaw((d) => ({
          ...d,
          suggestions: d.suggestions.map((x) => (x.id === id ? { ...x, status: 'added' as const } : x)),
        }))
      },

      dismissSuggestion(id) {
        setRaw((d) => ({
          ...d,
          suggestions: d.suggestions.map((x) => (x.id === id ? { ...x, status: 'dismissed' as const } : x)),
        }))
      },

      clearSeenSuggestions() {
        setRaw((d) => ({ ...d, suggestions: d.suggestions.filter((x) => x.status === 'new') }))
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
          // Semester dates are a single logical edit: saving both dates also
          // stamps imported timetable slots (whose validFrom defaults to the
          // import date) so classes appear immediately in Today/Calendar/Plan.
          // Only touched when at least one date is newly provided and the pair
          // is valid — never on unrelated setting changes.
          const prevStart = d.settings.semesterStart
          const prevEnd = d.settings.semesterEnd
          const start = next.settings.semesterStart
          const end = next.settings.semesterEnd
          const datesJustCompleted = !!(start && end) && !(prevStart && prevEnd)
          if (datesJustCompleted) {
            next.slots = next.slots.map((s) => ({ ...s, validFrom: start }))
          } else if (start && prevStart && start !== prevStart) {
            next.slots = next.slots.map((s) =>
              s.validFrom === prevStart ? { ...s, validFrom: start } : s,
            )
          }
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

      // ---- Stretch #4: multi-semester archive ----
      archiveSemester() {
        if (data.subjects.length === 0 && data.slots.length === 0) return null
        const today = todayStr()
        const rangeStart =
          data.settings.semesterStart ??
          (data.slots.length ? data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today) : today)
        const report = buildReport(data, today, rangeStart, today)
        const entry: ArchivedSemester = {
          id: newId('arch'),
          label: data.settings.semesterName || `Semester ending ${today}`,
          startDate: data.settings.semesterStart,
          endDate: data.settings.semesterEnd,
          archivedOn: today,
          subjectNames: data.subjects.map((s) => s.shortName || s.fullName),
          summary: report.bySubject.map((s) => `${s.shortName}: ${s.attended}/${s.held} (${Math.round(s.percent)}%)`),
          data: structuredClone(data),
        }
        saveArchive(entry)
        // Fresh start: keep nothing from the finished semester.
        clearData()
        setRaw(loadData())
        return entry
      },

      archivedSemesters() {
        return listArchives()
      },

      deleteArchived(id) {
        deleteArchive(id)
      },

      restoreArchive(id) {
        const arch = loadArchive(id)
        if (!arch) return false
        // If a live semester exists, archive it first so nothing is lost.
        if (data.subjects.length > 0 || data.slots.length > 0) {
          const today = todayStr()
          const rangeStart =
            data.settings.semesterStart ??
            (data.slots.length ? data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today) : today)
          const report = buildReport(data, today, rangeStart, today)
          saveArchive({
            id: newId('arch'),
            label: data.settings.semesterName || `Semester archived ${today}`,
            startDate: data.settings.semesterStart,
            endDate: data.settings.semesterEnd,
            archivedOn: today,
            subjectNames: data.subjects.map((s) => s.shortName || s.fullName),
            summary: report.bySubject.map((s) => `${s.shortName}: ${s.attended}/${s.held} (${Math.round(s.percent)}%)`),
            data: structuredClone(data),
          })
        }
        deleteArchive(id)
        setRaw(arch.data)
        return true
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
