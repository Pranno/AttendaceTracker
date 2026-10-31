// Reminder scheduling (F3, B11, D6/D7). Web builds use the browser Notification
// API plus a catch-up check on app open. Native (Capacitor/Android) builds fire
// real Local Notifications — scheduled at the user's chosen time (F3) with an
// id derived from the deadline so editing/deleting replaces/cancels them (D7).
// Every active deadline gets three arms: lead days before (default 7), 3 days
// before, and the day before — the last two always say "tomorrow"/"in 3 days".
// Two more daily native notifications: the evening "mark attendance" nudge at
// the user's chosen time, and a next-day class preview ("Attend / Can skip",
// with a threshold warning only for borderline subjects).

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { AppData, DateStr, Deadline } from '../data/model'
import { buildReport, freshData, isHoliday, slotsForDate, type AttendanceSummary } from './attendance'
import { addDays, formatShort, todayStr } from './dates'

/** The reminder date for a deadline given the lead time (F3: default 7 days). */
export function reminderDateFor(dl: Deadline, leadDays: number): DateStr | null {
  if (dl.done || !dl.dueDate) return null
  const rd = addDays(dl.dueDate, -leadDays)
  return rd
}

/** Deadlines whose reminder should have fired between `from` and `to`
 *  (inclusive), i.e. due within lead days and not yet done. */
export function deadlinesNeedingReminder(data: AppData, onOrBefore: DateStr): Deadline[] {
  const lead = data.settings.reminderLeadDays
  return data.deadlines.filter((dl) => {
    if (dl.done) return false
    const rd = reminderDateFor(dl, lead)
    return rd !== null && rd <= onOrBefore && dl.dueDate >= onOrBefore // not already past
  })
}

/** True when today's classes are not all marked and the evening nudge is due
 *  (B11). `nowTime` is HH:MM local. */
export function eveningNudgeDue(data: AppData, today: DateStr, nowTime: string): boolean {
  if (!data.settings.eveningReminderOn) return false
  if (nowTime < data.settings.eveningReminderTime) return false
  const slots = data.slots.filter(
    (s) =>
      s.validFrom <= today &&
      (s.validUntil === null || today <= s.validUntil),
  )
  if (slots.length === 0) return false
  return slots.some((s) => !data.marks.some((m) => m.date === today && m.slotId === s.id))
}

/** Ask for notification permission on the current platform. On native builds
 *  this must go through the Capacitor LocalNotifications plugin — the web
 *  Notification API is never "granted" inside the Android WebView, so using it
 *  there silently returns false and the OS prompt never appears. */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (isNative()) return ensureNativePermission()
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const res = await Notification.requestPermission()
  return res === 'granted'
}

export function fireNotification(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {
    /* some browsers restrict constructor use; ignore silently */
  }
}

/** Called on app open: shows any deadline reminders that came due while the
 *  app was closed (web approximation of the scheduled notifications). Each
 *  stage (lead / 3 days / day before) gets its own localStorage key so a
 *  user who opens the app at every stage sees each message exactly once. */
export function runCatchUpReminders(data: AppData): number {
  const today = todayStr()
  let fired = 0
  for (const dl of data.deadlines) {
    if (dl.done || !dl.dueDate) continue
    for (const st of deadlineReminderStages(dl, data.settings.reminderLeadDays)) {
      if (st.date > today || dl.dueDate < today) continue // stage not due yet / deadline passed
      const key = `attendancetracker.notified.${dl.id}.${st.stage}`
      try {
        if (localStorage.getItem(key)) continue
        localStorage.setItem(key, '1')
      } catch {
        /* storage may be unavailable; still fire */
      }
      const copy = deadlineCopy(dl, st.stage, data.settings.reminderLeadDays)
      fireNotification(copy.title, copy.body)
      fired += 1
    }
  }
  return fired
}

// ---------------- Native (Capacitor) local notifications — D6/D7 ----------------

/** True on a native platform where Local Notifications are available. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Stable numeric id for a deadline's notification (same deadline → same id,
 *  so reschedule replaces and cancel removes it — D7). The lead-stage slot is
 *  picked by `stage`: 0 = lead days before, 1 = 3 days before, 2 = day before. */
export function notifIdFor(deadlineId: string, stage = 0): number {
  let h = 0
  const s = `${deadlineId}#${stage}`
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 2_000_000_000) + 1 // avoid 0; under Java int max
}

/** Reserved ids for the recurring daily notifications (kept far from the
 *  hashed deadline ids so they can never collide). */
const EVENING_NUDGE_ID = 999_001
const TOMORROW_PLAN_ID = 999_002

export async function ensureNativePermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
    // 'denied' on Android 13+ is permanent for the session — re-calling
    // requestPermissions() afterwards silently no-ops, so bail out early.
    if (perm.display === 'denied') return false
    const res = await LocalNotifications.requestPermissions()
    return res.display === 'granted'
  } catch {
    return false
  }
}

function reminderDateTime(date: DateStr, time: string): Date {
  const [h, m] = (time || '18:00').split(':')
  const d = new Date(date + 'T00:00:00')
  d.setHours(Number(h) || 18, Number(m) || 0, 0, 0)
  return d
}

/** The three reminder stages for one deadline (D6 + user request):
 *  - stage 0: `leadDays` before the due date (F3 setting, default 7) — "a week to go"
 *  - stage 1: 3 days before — always worded "in 3 days"
 *  - stage 2: the day before — always worded "tomorrow"
 *  Past stages are dropped; a stage earlier than the lead is skipped so the
 *  same date never fires twice. */
export function deadlineReminderStages(dl: Deadline, leadDays: number): { stage: number; date: DateStr }[] {
  if (dl.done || !dl.dueDate) return []
  const wanted = [
    { stage: 0, date: addDays(dl.dueDate, -Math.max(1, leadDays)) },
    { stage: 1, date: addDays(dl.dueDate, -3) },
    { stage: 2, date: addDays(dl.dueDate, -1) },
  ]
  const seen = new Set<DateStr>()
  const out: { stage: number; date: DateStr }[] = []
  for (const w of wanted) {
    if (seen.has(w.date)) continue // e.g. lead = 3 → stage 0 and 1 share a date
    seen.add(w.date)
    out.push(w)
  }
  return out
}

function deadlineCopy(dl: Deadline, stage: number, leadDays: number): { title: string; body: string } {
  const when = dl.time ? ` at ${dl.time}` : ''
  switch (stage) {
    case 2:
      return { title: 'Deadline tomorrow', body: `${dl.title} — due tomorrow${when}` }
    case 1:
      return { title: 'Deadline in 3 days', body: `${dl.title} — due ${formatShort(dl.dueDate)}${when}` }
    default: {
      const n = Math.max(1, leadDays)
      return {
        title: n === 1 ? 'Deadline tomorrow' : `Deadline in ${n} days`,
        body: `${dl.title} — due ${formatShort(dl.dueDate)}${when}`,
      }
    }
  }
}

/** Schedule (or replace) the local notifications for one deadline — all three
 *  stages, each at the user's F3 arrival time. Past dates are skipped. No-op on web. */
export async function scheduleDeadlineNotification(dl: Deadline, leadDays: number, time: string): Promise<void> {
  if (!isNative()) return
  const now = Date.now()
  const future = deadlineReminderStages(dl, leadDays).filter((s) => reminderDateTime(s.date, time).getTime() > now)
  if (future.length === 0) return
  if (!(await ensureNativePermission())) return
  await LocalNotifications.schedule({
    notifications: future.map((s) => ({
      id: notifIdFor(dl.id, s.stage),
      ...deadlineCopy(dl, s.stage, leadDays),
      schedule: { at: reminderDateTime(s.date, time) },
      smallIcon: 'ic_stat_icon_config_sample',
    })),
  })
}

/** Cancel every scheduled notification for a deadline (D7: deleting cancels them). */
export async function cancelDeadlineNotification(deadlineId: string): Promise<void> {
  if (!isNative()) return
  try {
    await LocalNotifications.cancel({
      notifications: [0, 1, 2].map((stage) => ({ id: notifIdFor(deadlineId, stage) })),
    })
  } catch {
    /* not scheduled — nothing to cancel */
  }
}

/** Re-sync every active deadline with the OS scheduler after settings change
 *  (lead days or time edited in Settings → all reminders re-armed), then
 *  re-arm the two recurring daily notifications. */
export async function resyncAllNotifications(data: AppData): Promise<void> {
  if (!isNative()) return
  for (const dl of data.deadlines) await cancelDeadlineNotification(dl.id)
  for (const dl of data.deadlines) {
    if (!dl.done) await scheduleDeadlineNotification(dl, data.settings.reminderLeadDays, data.settings.notificationTime)
  }
  await syncDailyNotifications(data)
}

// ---------------- Daily notifications: evening nudge + tomorrow's plan ----------------

/** Evening "mark your attendance" nudge (B11) — fires now on both platforms. */
export async function fireEveningNudgeAsync(title: string, body: string): Promise<void> {
  if (isNative()) {
    if (!(await ensureNativePermission())) return
    await LocalNotifications.schedule({
      notifications: [{ id: EVENING_NUDGE_ID, title, body, schedule: { at: new Date(Date.now() + 500) } }],
    })
    return
  }
  fireNotification(title, body)
}

/** One entry per class still unmarked on `today` — used by the scheduled
 *  evening nudge so it can name what is missing ("Physics, Lab"). */
export function unmarkedTodayClasses(data: AppData, today: DateStr): string[] {
  const names: string[] = []
  for (const slot of slotsForDate(data, today)) {
    if (data.marks.some((m) => m.date === today && m.slotId === slot.id)) continue
    const subj = data.subjects.find((s) => s.id === slot.subjectId)
    if (subj) names.push(subj.shortName || subj.fullName)
  }
  return names
}

/** Schedule (or replace) the recurring evening nudge for the next occurrence
 *  of the user's chosen time. Cancelled when the toggle is off. */
async function armEveningNudge(data: AppData): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: EVENING_NUDGE_ID }] })
  } catch {
    /* nothing armed yet */
  }
  if (!data.settings.eveningReminderOn) return
  const today = todayStr()
  let at = reminderDateTime(today, data.settings.eveningReminderTime)
  if (at.getTime() <= Date.now()) at = reminderDateTime(addDays(today, 1), data.settings.eveningReminderTime)
  // Stay silent when the timetable is empty or every slot has expired.
  const tomorrow = addDays(today, 1)
  const hasAnySlots = data.slots.some((s) => s.validUntil === null || tomorrow <= s.validUntil)
  if (!hasAnySlots) return
  if (!(await ensureNativePermission())) return
  await LocalNotifications.schedule({
    notifications: [
      {
        id: EVENING_NUDGE_ID,
        title: 'Mark your attendance',
        body: "Today\u2019s classes aren\u2019t all marked yet. Open Attendance Buddy to log them.",
        // Repeats daily at the chosen time; fires even under Doze so the
        // nudge isn't silently delayed by battery optimisation.
        schedule: { at, repeats: true, allowWhileIdle: true },
        smallIcon: 'ic_stat_icon_config_sample',
      },
    ],
  })
}

/** A subject sits exactly at the threshold (canMiss === 0) — skipping one
 *  more class drops it below, so the plan notification warns about it but
 *  still lists it under "Can skip". */
export function isBorderlineSummary(s: AttendanceSummary): boolean {
  return s.held > 0 && s.status !== 'nodata' && s.percent >= s.threshold && s.canMiss === 0
}

/** Split tomorrow's classes into must-attend vs can-skip using the live
 *  attendance maths: a class lands in "Have to attend" when its subject is
 *  already below the threshold, or when skipping it would drop the subject
 *  below it (canMiss === 0). Borderline subjects are listed under Can skip
 *  with a warning instead of being forced into Must attend. Pure — testable. */
export function classifyTomorrowSlots(
  data: AppData,
  tomorrow: DateStr,
  summaries: AttendanceSummary[],
): { must: string[]; skip: string[]; warn: string[] } {
  const bySubject = new Map(summaries.map((s) => [s.subjectId, s]))
  const must: string[] = []
  const skip: string[] = []
  const warn: string[] = []
  for (const slot of slotsForDate(data, tomorrow)) {
    const subj = data.subjects.find((s) => s.id === slot.subjectId)
    if (!subj) continue
    const label = `${subj.shortName || subj.fullName} ${slot.startTime}`
    const sum = bySubject.get(slot.subjectId)
    if (!sum || sum.held === 0 || sum.status === 'nodata') {
      skip.push(label) // no history yet — nothing to protect
      continue
    }
    if (sum.status === 'below') must.push(label)
    else if (isBorderlineSummary(sum)) {
      skip.push(label)
      if (!warn.includes(subj.shortName || subj.fullName))
        warn.push(`${subj.shortName || subj.fullName} is at ${Math.round(sum.threshold)}% \u2014 skipping puts you below`)
    } else skip.push(label)
  }
  return { must, skip, warn }
}

/** Build the "tomorrow's classes" notification copy from live data. Returns
 *  null when there is nothing scheduled (or everything is cancelled/holiday). */
export function buildTomorrowPlanContent(data: AppData, tomorrow: DateStr): { title: string; body: string } | null {
  if (isHoliday(data, tomorrow)) return null
  const rangeStart = data.settings.semesterStart ?? data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), tomorrow)
  const report = buildReport(freshData(data), todayStr(), rangeStart, todayStr())
  const { must, skip, warn } = classifyTomorrowSlots(data, tomorrow, report.bySubject)
  if (must.length === 0 && skip.length === 0) return null
  const parts: string[] = []
  if (must.length) parts.push(`Have to attend: ${must.join(', ')}`)
  if (skip.length) parts.push(`Can skip: ${skip.join(', ')}`)
  let body = parts.join(' \u00b7 ')
  if (warn.length) body += ` \u26a0\ufe0f ${warn.join('; ')}`
  return { title: "Tomorrow's classes", body }
}

/** Schedule (or replace) the recurring next-day class preview. Fires every
 *  day at the user's chosen arrival time; only armed when there is something
 *  to show for tomorrow (the app re-arms on every open, so a new week's
 *  plan lands as soon as the user touches the app). */
async function armTomorrowPlan(data: AppData): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: TOMORROW_PLAN_ID }] })
  } catch {
    /* nothing armed yet */
  }
  const content = buildTomorrowPlanContent(data, addDays(todayStr(), 1))
  if (!content) return // holiday / no classes tomorrow — stay silent
  if (!(await ensureNativePermission())) return
  let at = reminderDateTime(todayStr(), data.settings.notificationTime)
  if (at.getTime() <= Date.now()) at = reminderDateTime(addDays(todayStr(), 1), data.settings.notificationTime)
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TOMORROW_PLAN_ID,
        title: content.title,
        body: content.body,
        schedule: { at, repeats: true, allowWhileIdle: true },
        smallIcon: 'ic_stat_icon_config_sample',
      },
    ],
  })
}

/** Arm/disarm both recurring daily notifications. Called whenever data or
 *  settings change while the app is open (native only; web relies on the
 *  open-app checks). Content is a snapshot taken now — the app re-syncs on
 *  every launch, which keeps the plan fresh in practice. */
export async function syncDailyNotifications(data: AppData): Promise<void> {
  if (!isNative()) return
  await armEveningNudge(data)
  await armTomorrowPlan(data)
}
