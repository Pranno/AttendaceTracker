// ============================================================
// Attendance Tracker — shared data model (Data model section)
// One file defines every record; everything else imports from here.
// Dates are stored as YYYY-MM-DD and shown day first.
// ============================================================

/** A calendar date written as YYYY-MM-DD, e.g. "2026-10-28". */
export type DateStr = string

export type ClassType = 'lecture' | 'lab' | 'tutorial' | 'online'
/** `cancelled` is C4: a future class marked off in advance — it does not
 *  count as held (same maths as noclass). */
export type MarkStatus = 'present' | 'absent' | 'noclass' | 'cancelled' | 'converted'

/** Stretch #5: one converted lecture. The class that happened on `date` in
 *  place of `slotId`'s usual subject was really `subjectId`'s lecture
 *  (e.g. the WAD period was taken by FE because the teacher was away). */
export interface Conversion {
  id: string
  date: DateStr
  /** The timetable slot whose period got taken over. */
  slotId: string
  /** The subject that actually took the period. */
  subjectId: string
  note?: string
}

/** The conversion recorded for one date+slot, if any. */
export function conversionFor(conversions: Conversion[], date: DateStr, slotId: string): Conversion | undefined {
  return conversions.find((c) => c.date === date && c.slotId === slotId)
}

/** Settings — created at first launch. */
export interface AppSettings {
  /** F1: minimum attendance percentage the user wants to keep (1–100, default 75). */
  threshold: number
  /** F3: reminder lead time in days before a deadline (default 7). */
  reminderLeadDays: number
  /** F3: time of day notifications arrive, HH:MM. */
  notificationTime: string
  /** F4: evening "mark your attendance" reminder on/off and its time. */
  eveningReminderOn: boolean
  eveningReminderTime: string
  /** F13: subject cards on Today show the next class room & teacher. */
  showRoomTeacher: boolean
  /** F14: quick actions (Mark / Add deadline) shown in the day sheet. */
  showQuickActions: boolean
  /** F5: semester name, start date (first day of college), tentative end date. */
  semesterName: string
  semesterStart: DateStr | null
  semesterEnd: DateStr | null
  /** F10: assumed past attendance % for unmarked past classes (0–100, default 80). */
  assumedPastAttendance: number
  /** J2: the month the plan starts (1st of the month after the timetable was first confirmed), "YYYY-MM". */
  planStartMonth: string | null
  /** E16: commute minutes (default 30). */
  commuteMinutes: number
  /** A13: Sunday classes on/off (off by default). */
  sundayClasses: boolean
  /** B14: unmarked classes — leave blank (default) or count as present. */
  unmarkedAsPresent: boolean
  /** F15 / T8 (batch rule): the user's batch inside their division, e.g. "A1".
   *  Format: division letter + optional batch number ("A", "A1", "B2").
   *  Slots tagged with a different batch of the same division are hidden;
   *  slots tagged with no batch belong to the whole class. */
  myBatch: string
  /** User's division letter ("A"–"E") — editable from Settings. Derived from
   *  myBatch when that is set, but kept separate so a division can be chosen
   *  even before picking a batch. */
  myDivision: string
  /** Onboarding wizard: true once the intro tour has been seen/dismissed. */
  onboarded: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  threshold: 75,
  reminderLeadDays: 7,
  notificationTime: '18:00',
  eveningReminderOn: false,
  eveningReminderTime: '20:00',
  showRoomTeacher: true,
  showQuickActions: true,
  semesterName: '',
  semesterStart: null,
  semesterEnd: null,
  assumedPastAttendance: 80,
  planStartMonth: null,
  commuteMinutes: 30,
  sundayClasses: false,
  unmarkedAsPresent: false,
  myBatch: '',
  myDivision: '',
  onboarded: false,
}

/** Subject — created when the timetable is confirmed (A6) or added by hand. */
/** E5 marking-scheme component. `fromAttendance` = automatic attended÷held fraction. */
export interface MarkingComponent {
  id: string
  label: string
  weight: number // marks it is worth
  outOf?: number // maximum for one entry
  expectedEntries?: number
  bestN?: number // only the N best scores (by percentage) count
  fromAttendance?: boolean
}

export interface Subject {
  id: string
  shortName: string
  fullName: string
  credits?: number
  /** E5: marking scheme built by hand. */
  markingScheme?: MarkingComponent[]
  /** B8: totals typed by the user from the college ERP. When set, they replace
   * calculated/assumed figures for that subject (J6). */
  typedAttended?: number
  typedHeld?: number
  /** F2 (Stretch): optional separate threshold for this subject. */
  thresholdOverride?: number
  /** M6: nicknames used by the reminder reader, e.g. ["maths", "calculus"]. */
  nicknames: string[]
}

/** Slot — one class on the weekly timetable (a weekly repeat, A7). */
export interface Slot {
  id: string
  subjectId: string
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
  /** "09:00" — 24-hour HH:MM. */
  startTime: string
  endTime: string
  type: ClassType
  room: string
  teacher: string
  /** Batch tag from the timetable, e.g. "A1", "B3". Empty/undefined = the
   *  whole division sees this class (e.g. a plain "A SDC (L)" lecture). */
  batch?: string
  /** A8: edits apply from this day onward; past days keep what they had. */
  validFrom: DateStr
  /** null = until replaced or the semester ends. */
  validUntil: DateStr | null
}

// ---------------- Batch rules (user requirement + doc T8) ----------------
// Div A has batches A1/A2/A3. A slot tagged "A1" belongs only to batch A1;
// a slot with no batch tag belongs to the whole class/division.

/** Split "A1" -> { div: "A", num: 1 }; "A" -> { div: "A" }; "" -> null. */
export function parseBatchTag(tag: string | undefined | null): { div: string; num: number | null } | null {
  if (!tag) return null
  const m = /^([A-Za-z])\s*[-_ ]?(\d+)?$/.exec(tag.trim())
  if (!m) return null
  return { div: m[1].toUpperCase(), num: m[2] ? Number(m[2]) : null }
}

/** True when `slotBatch` is the user's class given their chosen `myBatch`.
 *  - No tag on the slot → everyone attends (whole class / division-wide).
 *  - Same exact tag → mine.
 *  - Different batch of the same division → not mine.
 *  - User picked only a division ("A") → show everything in division A.
 *  - Different division letter → not mine. */
export function slotMatchesBatch(slotBatch: string | undefined | null, myBatch: string): boolean {
  const s = parseBatchTag(slotBatch)
  if (!s) return true // untagged: whole class
  const me = parseBatchTag(myBatch)
  if (!me) return true // user hasn't chosen a batch yet: show everything
  if (s.div !== me.div) return false
  if (me.num === null) return true // "A" sees all of A1/A2/A3
  return s.num === me.num || s.num === null
}

/** Mark — the user's attendance choice for one slot on one date. */
export interface Mark {
  /** Unique id (date + slot id). */
  id: string
  date: DateStr
  slotId: string
  status: MarkStatus
}

/** Holiday / no-class day (A12). Exam days can be marked too but still count as classes. */
export interface Holiday {
  id: string
  startDate: DateStr
  endDate: DateStr
  label: string
  /** Exam day: shown differently, but its classes count as normal (section J). */
  isExamDay: boolean
}

/** Deadline (D, E6). */
export interface Deadline {
  id: string
  subjectId?: string
  title: string
  /** The due date (for a range, the end date, C9). */
  dueDate: DateStr
  /** For a range: when it opens. */
  startDate?: DateStr
  time?: string
  notes?: string
  tentative: boolean
  done: boolean
  /** E6: "done" tick for a unit-covering test may be separate; kept simple: done covers both. */
  /** The pasted message it came from (E6/D records). */
  sourceText?: string
  /** Scheduled reminder dates (kept so deleting cancels them, data rule). */
  reminderDates: DateStr[]
  /** E6: units this deadline covers. */
  unitIds?: string[]
  /** H8: course links this deadline is about (e.g. "WAD certificates").
   *  The deadline row shows their progress, e.g. "6 of 10 done". */
  courseLinkIds?: string[]
}

// ---- Study records (defined now so later steps import from this same file) ----

export interface Topic {
  name: string
  taughtDate: DateStr | null
  revisedDate: DateStr | null
  /** S14: the group heading it sits under. */
  group?: string
}

/** E10: a practice question held by a unit. Boxes 0–4; due after
 * BOX_INTERVALS[box] days (0, 1, 3, 7, 14). */
export interface PracticeQuestion {
  id: string
  text: string
  code?: string
  table?: string
  answer: string
  box: number
  dueOn: DateStr | null
  lastAnswerOn: DateStr | null
  missedOnce?: boolean
}

/** Unit (E2, E3). Project subjects use stages ticked "done" instead. */
export interface Unit {
  id: string
  subjectId: string
  title: string
  hoursInClass: number
  topics: Topic[]
  revisedDate: DateStr | null
  refreshedDate?: DateStr
  kind: 'unit' | 'stage'
  /** E10: practice questions with spaced repetition. */
  questions?: PracticeQuestion[]
}

export interface Score {
  id: string
  subjectId: string
  name: string
  marksGot: number
  outOf: number
  /** E5: the marking-scheme component this score belongs to. */
  componentId?: string
}

/** E11: one entry in the CGPA planner. Either per-subject grades or a known SGPA. */
export interface CgpaSemester {
  id: string
  label: string
  mode: 'subjects' | 'sgpa'
  subjects?: { name?: string; credits: number; grade: string }[]
  sgpa?: number
  credits?: number
}

export interface FocusSession {
  id: string
  date: DateStr
  minutes: number
  kind: 'study' | 'project' | 'break'
}

/** Course link (record, H / Special courses). */
export interface CourseLink {
  id: string
  subjectId: string
  /** Unit heading text this course sits under (H1 grouping), e.g. "Unit 1: Introduction & HTML". */
  unitTitle?: string
  unitNumber?: number
  name: string
  platform: string
  /** Empty until the user adds one — allowed for no-link syllabus entries (H9). */
  url: string
  coNumber?: string
  status: 'not started' | 'started' | 'completed'
  completedDate?: DateStr
  /** H8: ticked "certificate submitted" with a date. */
  certificateSubmittedDate?: DateStr
  /** H4: marked "check link" when the reader could not read it cleanly. */
  needsChecking: boolean
}

/** H11: merge next semester's imported links into the existing list —
 *  new ones are added, links that are still there keep their status/dates.
 *  Matching is by subject + normalized name (+ unit when both have one). */
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function mergeCourseLinks(existing: CourseLink[], incoming: CourseLink[]): CourseLink[] {
  const out = [...existing]
  let added = 0
  for (const inc of incoming) {
    const match = out.find(
      (x) =>
        x.subjectId === inc.subjectId &&
        normName(x.name) === normName(inc.name) &&
        (x.unitNumber == null || inc.unitNumber == null || x.unitNumber === inc.unitNumber),
    )
    if (match) continue // still there → keep its status/dates (H11)
    out.push({ ...inc, id: `${inc.id}_n${added}` })
    added += 1
  }
  return out
}

/** Suggestion (record, section I). */
export interface Suggestion {
  id: string
  kind: 'deadline' | 'activity' | 'notice'
  title: string
  subjectId?: string
  date: DateStr | null
  time?: string
  sourceSnippet: string
  cameFrom: 'share' | 'notification' | 'gmail'
  messageId?: string
  status: 'new' | 'added' | 'dismissed'
}

/** Event (record, section I calendar events). */
export interface CalendarEvent {
  id: string
  title: string
  date: DateStr
  startTime?: string
  endTime?: string
  place?: string
  reminderOn: boolean
  source: string
}

/** The whole saved app state. */
export interface AppData {
  version: 1
  settings: AppSettings
  subjects: Subject[]
  slots: Slot[]
  marks: Mark[]
  holidays: Holiday[]
  deadlines: Deadline[]
  units: Unit[]
  scores: Score[]
  focusSessions: FocusSession[]
  courseLinks: CourseLink[]
  suggestions: Suggestion[]
  events: CalendarEvent[]
  /** Stretch #5: converted lectures (subject swap on a given day). */
  conversions: Conversion[]
  /** E11: CGPA planner semesters (kept when a new semester starts, E14). */
  cgpaSemesters?: CgpaSemester[]
}

export const EMPTY_DATA: AppData = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  subjects: [],
  slots: [],
  marks: [],
  holidays: [],
  deadlines: [],
  units: [],
  scores: [],
  focusSessions: [],
  courseLinks: [],
  suggestions: [],
  events: [],
  conversions: [],
}

let counter = 0
/** Small unique id generator (no external dependency needed offline). */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}
