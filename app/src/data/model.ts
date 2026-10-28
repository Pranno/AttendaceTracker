// ============================================================
// Attendance Tracker — shared data model (Data model section)
// One file defines every record; everything else imports from here.
// Dates are stored as YYYY-MM-DD and shown day first.
// ============================================================

/** A calendar date written as YYYY-MM-DD, e.g. "2026-10-28". */
export type DateStr = string

export type ClassType = 'lecture' | 'lab' | 'tutorial' | 'online'
export type MarkStatus = 'present' | 'absent' | 'noclass'

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  threshold: 75,
  reminderLeadDays: 7,
  notificationTime: '18:00',
  eveningReminderOn: false,
  eveningReminderTime: '20:00',
  semesterName: '',
  semesterStart: null,
  semesterEnd: null,
  assumedPastAttendance: 80,
  planStartMonth: null,
  commuteMinutes: 30,
  sundayClasses: false,
  unmarkedAsPresent: false,
}

/** Subject — created when the timetable is confirmed (A6) or added by hand. */
export interface Subject {
  id: string
  shortName: string
  fullName: string
  credits?: number
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
  /** A8: edits apply from this day onward; past days keep what they had. */
  validFrom: DateStr
  /** null = until replaced or the semester ends. */
  validUntil: DateStr | null
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
  /** The pasted message it came from (E6/D records). */
  sourceText?: string
  /** Scheduled reminder dates (kept so deleting cancels them, data rule). */
  reminderDates: DateStr[]
  /** E6: units this deadline covers. */
  unitIds?: string[]
}

// ---- Study records (defined now so later steps import from this same file) ----

export interface Topic {
  name: string
  taughtDate: DateStr | null
  revisedDate: DateStr | null
  /** S14: the group heading it sits under. */
  group?: string
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
}

export interface Score {
  id: string
  subjectId: string
  name: string
  marksGot: number
  outOf: number
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
  unitNumber?: number
  name: string
  platform: string
  url: string
  coNumber?: string
  status: 'not started' | 'started' | 'completed'
  completedDate?: DateStr
  certificateSubmittedDate?: DateStr
  needsChecking: boolean
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
}

let counter = 0
/** Small unique id generator (no external dependency needed offline). */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}
