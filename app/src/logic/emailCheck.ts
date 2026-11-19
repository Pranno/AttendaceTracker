// Check Gmail for new deadlines — used by the "Fetch from Gmail" button and
// automatically when the app opens (at most every few hours). New finds are
// added as suggestions AND announced with a notification.

import type { AppData, Suggestion } from '../data/model'
import { fetchInbox, hasGmailSetup, isConnected, parseMessagesWith, toSuggestions } from './gmail'
import { notifyNow } from './reminders'
import { deadlineReaderOf } from './smartDeadlines'
import { formatShort } from './dates'

const LAST_CHECK = 'at.gmail.lastAutoCheck.v1'
export const AUTO_CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface EmailCheckResult {
  checked: number
  fresh: Suggestion[]
  reader: 'standard' | 'smart'
  fallbackReason?: string
}

/** "Lab report (due 25 Nov), Hackathon registration (due 28 Nov) +1 more" */
export function describeFinds(fresh: Suggestion[]): string {
  const parts = fresh.slice(0, 2).map((s) => `${s.title}${s.date ? ` (due ${formatShort(s.date)})` : ''}`)
  return parts.join(', ') + (fresh.length > 2 ? ` +${fresh.length - 2} more` : '')
}

export async function checkEmailForDeadlines(
  data: AppData,
  addSuggestions: (s: Suggestion[]) => void,
  opts: { notify?: boolean } = {},
): Promise<EmailCheckResult> {
  const msgs = await fetchInbox(25)
  // only emails not seen before are read (saves the Smart reader's free limit)
  const seenIds = new Set(data.suggestions.map((s) => s.messageId).filter(Boolean))
  const unseen = msgs.filter((m) => !seenIds.has(m.id))
  const { parsed, reader, fallbackReason } = await parseMessagesWith(unseen, data.subjects, deadlineReaderOf(data.settings))
  const fresh = toSuggestions(parsed, data.suggestions, data.subjects)
  addSuggestions(fresh)
  if (fresh.length > 0 && opts.notify !== false) {
    await notifyNow(
      `📬 ${fresh.length} new deadline${fresh.length === 1 ? '' : 's'} from your email`,
      `${describeFinds(fresh)}. Open the app to add ${fresh.length === 1 ? 'it' : 'them'} to your calendar.`,
    ).catch(() => {})
  }
  try {
    localStorage.setItem(LAST_CHECK, String(Date.now()))
  } catch {
    /* ignore */
  }
  return { checked: msgs.length, fresh, reader, fallbackReason }
}

/** Run on app open: check Gmail if connected and not checked recently. */
export async function autoCheckEmail(data: AppData, addSuggestions: (s: Suggestion[]) => void): Promise<void> {
  if (!hasGmailSetup() || !(await isConnected())) return
  let last = 0
  try {
    last = Number(localStorage.getItem(LAST_CHECK) ?? 0)
  } catch {
    /* ignore */
  }
  if (Date.now() - last < AUTO_CHECK_EVERY_MS) return
  try {
    await checkEmailForDeadlines(data, addSuggestions, { notify: true })
  } catch {
    /* offline / signed out — try again next time the app opens */
  }
}
