// Check Gmail for new deadlines — used by the "Fetch from Gmail" button and
// automatically when the app starts or comes back to the front (at most every
// 3 hours). Deadlines in the categories chosen in Settings (exams,
// submissions, official forms, college events — optionally only from the
// college's own mail domain) are ADDED straight away; everything else is
// kept as a suggestion to add by hand. A notification says what happened.

import type { AppData, Deadline, Suggestion } from '../data/model'
import { connectedEmail, fetchInbox, hasGmailSetup, isConnected, parseMessagesWith, toSuggestions } from './gmail'
import { notifyNow } from './reminders'
import { deadlineReaderOf } from './smartDeadlines'
import { formatShort } from './dates'
import { AUTO_ADD_DEFAULT, collegeDomainOf, fromCollege } from './deadlineCategory'

const LAST_CHECK = 'at.gmail.lastAutoCheck.v1'
export const AUTO_CHECK_EVERY_MS = 3 * 60 * 60 * 1000

export interface EmailApi {
  addSuggestions: (s: Suggestion[]) => void
  addDeadline: (d: Omit<Deadline, 'id' | 'reminderDates' | 'done' | 'tentative'> & { tentative?: boolean }, id?: string) => void
}

export interface EmailCheckResult {
  checked: number
  fresh: Suggestion[]
  /** of `fresh`, the ones added to deadlines automatically */
  autoAdded: Suggestion[]
  reader: 'standard' | 'smart'
  fallbackReason?: string
}

/** "Lab report (due 25 Nov), Hackathon registration (due 28 Nov) +1 more" */
export function describeFinds(list: Suggestion[]): string {
  const parts = list.slice(0, 2).map((s) => `${s.title}${s.date ? ` (due ${formatShort(s.date)})` : ''}`)
  return parts.join(', ') + (list.length > 2 ? ` +${list.length - 2} more` : '')
}

/** Should this email suggestion go straight into the deadlines? */
export function shouldAutoAdd(s: Suggestion, settings: AppData['settings'], collegeDomain: string | null): boolean {
  if (settings.emailAutoAdd === false || !s.date) return false
  const cats = settings.emailAutoAddCategories ?? AUTO_ADD_DEFAULT
  if (!cats.includes(s.category ?? 'other')) return false
  if (settings.emailCollegeOnly !== false && !fromCollege(s.from ?? '', collegeDomain)) return false
  return true
}

export async function checkEmailForDeadlines(data: AppData, api: EmailApi, opts: { notify?: boolean } = {}): Promise<EmailCheckResult> {
  const msgs = await fetchInbox(25)
  // only emails not seen before are read (saves the Smart reader's free limit)
  const seenIds = new Set(data.suggestions.map((s) => s.messageId).filter(Boolean))
  const unseen = msgs.filter((m) => !seenIds.has(m.id))
  const { parsed, reader, fallbackReason } = await parseMessagesWith(unseen, data.subjects, deadlineReaderOf(data.settings))
  const fresh = toSuggestions(parsed, data.suggestions, data.subjects)

  const domain = collegeDomainOf(await connectedEmail().catch(() => null))
  const autoAdded: Suggestion[] = []
  const final = fresh.map((s) => {
    if (!shouldAutoAdd(s, data.settings, domain)) return s
    // never add the same deadline twice
    const dup = data.deadlines.some((d) => d.dueDate === s.date && d.title.trim().toLowerCase() === s.title.trim().toLowerCase())
    if (dup) return { ...s, status: 'added' as const }
    const id = `dl_${s.id}`
    api.addDeadline({ title: s.title, dueDate: s.date!, subjectId: s.subjectId, sourceText: s.sourceSnippet }, id)
    const added = { ...s, status: 'added' as const, autoDeadlineId: id }
    autoAdded.push(added)
    return added
  })
  api.addSuggestions(final)

  const toReview = final.filter((s) => s.status === 'new')
  if (opts.notify !== false && (autoAdded.length || toReview.length)) {
    const title = autoAdded.length
      ? `📬 Added ${autoAdded.length} deadline${autoAdded.length === 1 ? '' : 's'} from your email`
      : `📬 ${toReview.length} new deadline${toReview.length === 1 ? '' : 's'} from your email`
    const body = autoAdded.length
      ? `${describeFinds(autoAdded)}.${toReview.length ? ` ${toReview.length} more to review in the app.` : ''}`
      : `${describeFinds(toReview)}. Open the app to add ${toReview.length === 1 ? 'it' : 'them'}.`
    await notifyNow(title, body).catch(() => {})
  }
  try {
    localStorage.setItem(LAST_CHECK, String(Date.now()))
  } catch {
    /* ignore */
  }
  return { checked: msgs.length, fresh: final, autoAdded, reader, fallbackReason }
}

/** App start / back to the front: check Gmail if connected and not checked in the last 3 hours. */
export async function autoCheckEmail(data: AppData, api: EmailApi): Promise<void> {
  if (!hasGmailSetup() || !(await isConnected())) return
  let last = 0
  try {
    last = Number(localStorage.getItem(LAST_CHECK) ?? 0)
  } catch {
    /* ignore */
  }
  if (Date.now() - last < AUTO_CHECK_EVERY_MS) return
  try {
    await checkEmailForDeadlines(data, api, { notify: true })
  } catch {
    /* offline / signed out — try again next time */
  }
}
