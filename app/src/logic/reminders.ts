// Reminder scheduling (F3, B11). On the web build we use the Notification
// API plus a catch-up check on app open; the Capacitor step will swap the
// actual firing to Local Notifications while keeping these helpers.

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
