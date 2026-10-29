// Reminder scheduling (F3, B11, D6/D7). Web builds use the browser Notification
// API plus a catch-up check on app open. Native (Capacitor/Android) builds fire
// real Local Notifications — scheduled at the user's chosen time (F3) with an
// id derived from the deadline so editing/deleting replaces/cancels them (D7).

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { AppData, DateStr, Deadline } from '../data/model'
import { addDays, todayStr } from './dates'

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

export async function ensureNotifyPermission(): Promise<boolean> {
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
 *  app was closed (web approximation of the scheduled notification). */
export function runCatchUpReminders(data: AppData): number {
  const today = todayStr()
  let fired = 0
  for (const dl of deadlinesNeedingReminder(data, today)) {
    const key = `attendancetracker.notified.${dl.id}`
    try {
      if (localStorage.getItem(key)) continue
      localStorage.setItem(key, '1')
    } catch {
      /* storage may be unavailable; still fire */
    }
    const daysLeft = Math.max(0, diffDaysLocal(today, dl.dueDate))
    fireNotification(
      'Deadline coming up',
      `${dl.title} — due ${dl.dueDate} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`,
    )
    fired += 1
  }
  return fired
}

function diffDaysLocal(a: DateStr, b: DateStr): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

// ---------------- Native (Capacitor) local notifications — D6/D7 ----------------

/** True on a native platform where Local Notifications are available. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Stable numeric id for a deadline's notification (same deadline → same id,
 *  so reschedule replaces and cancel removes it — D7). */
export function notifIdFor(deadlineId: string): number {
  let h = 0
  for (let i = 0; i < deadlineId.length; i++) h = (h * 31 + deadlineId.charCodeAt(i)) >>> 0
  return (h % 2_000_000_000) + 1 // avoid 0; under Java int max
}

async function ensureNativePermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
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

/** Schedule (or replace) the local notification for one deadline at the
 *  user's F3 time. Past dates are skipped. No-op on web. */
export async function scheduleDeadlineNotification(dl: Deadline, leadDays: number, time: string): Promise<void> {
  if (!isNative()) return
  const rd = reminderDateFor(dl, leadDays)
  if (!rd) return
  const at = reminderDateTime(rd, time)
  if (at.getTime() <= Date.now()) return
  if (!(await ensureNativePermission())) return
  await LocalNotifications.schedule({
    notifications: [
      {
        id: notifIdFor(dl.id),
        title: 'Deadline coming up',
        body: `${dl.title} — due ${dl.dueDate}`,
        schedule: { at },
        smallIcon: 'ic_stat_icon_config_sample',
      },
    ],
  })
}

/** Cancel a deadline's scheduled notification (D7: deleting cancels it). */
export async function cancelDeadlineNotification(deadlineId: string): Promise<void> {
  if (!isNative()) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: notifIdFor(deadlineId) }] })
  } catch {
    /* not scheduled — nothing to cancel */
  }
}

/** Re-sync every active deadline with the OS scheduler after settings change
 *  (lead days or time edited in Settings → all reminders re-armed). */
export async function resyncAllNotifications(data: AppData): Promise<void> {
  if (!isNative()) return
  for (const dl of data.deadlines) await cancelDeadlineNotification(dl.id)
  for (const dl of data.deadlines) {
    if (!dl.done) await scheduleDeadlineNotification(dl, data.settings.reminderLeadDays, data.settings.notificationTime)
  }
}

/** Evening "mark your attendance" nudge (B11) — fires now on both platforms. */
export async function fireEveningNudgeAsync(title: string, body: string): Promise<void> {
  if (isNative()) {
    if (!(await ensureNativePermission())) return
    await LocalNotifications.schedule({
      notifications: [{ id: 999_001, title, body, schedule: { at: new Date(Date.now() + 500) } }],
    })
    return
  }
  fireNotification(title, body)
}
