// Check Gmail for new deadlines — used by the "Fetch from Gmail" button and
// automatically when the app starts or comes back to the front (at most every
// 3 hours). Deadlines in the categories chosen in Settings (exams,
// submissions, official forms, college events — optionally only from the
// college's own mail domain) are ADDED straight away; everything else is
// kept as a suggestion to add by hand. A notification says what happened.

import type { AppData, Deadline, Suggestion } from '../data/model'
import { backgroundNotifiedIds } from './gmailNative'
import { categorize } from './deadlineCategory'
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
  /** change suggestions already saved (used to auto-add ones found by an older fetch) */
  updateSuggestions?: (patch: Map<string, Partial<Suggestion>>) => void
}

const NOTIFIED = 'at.gmail.notified.v1'
function loadNotified(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function saveNotified(ids: Set<string>) {
  try {
    localStorage.setItem(NOTIFIED, JSON.stringify([...ids].slice(-500)))
  } catch {
    /* ignore */
  }
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
  // sender unknown (found by an older version) → can't tell, don't block
  if (settings.emailCollegeOnly !== false && s.from && !fromCollege(s.from, collegeDomain)) return false
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
  const takenKeys = new Set(data.deadlines.map((d) => `${d.dueDate}|${d.title.trim().toLowerCase()}`))
  const tryAdd = (s: Suggestion): Suggestion => {
    if (!shouldAutoAdd(s, data.settings, domain)) return s
    const key = `${s.date}|${s.title.trim().toLowerCase()}`
    if (takenKeys.has(key)) return { ...s, status: 'added' as const } // never add the same deadline twice
    takenKeys.add(key)
    const id = `dl_${s.id}`
    api.addDeadline({ title: s.title, dueDate: s.date!, subjectId: s.subjectId, sourceText: s.sourceSnippet }, id)
    const added = { ...s, status: 'added' as const, autoDeadlineId: id }
    autoAdded.push(added)
    return added
  }
  const final = fresh.map(tryAdd)
  api.addSuggestions(final)

  // suggestions an earlier fetch left waiting that now qualify
  if (api.updateSuggestions) {
    const patch = new Map<string, Partial<Suggestion>>()
    for (const old of data.suggestions) {
      if (old.status !== 'new' || old.cameFrom !== 'gmail') continue
      const withCat = old.category ? old : { ...old, category: categorize(old.title, old.sourceSnippet) }
      const r = tryAdd(withCat)
      if (r.status !== 'new' || r.category !== old.category) patch.set(old.id, { status: r.status, category: r.category, autoDeadlineId: r.autoDeadlineId })
    }
    if (patch.size) api.updateSuggestions(patch)
  }

  // one notification per email: skip emails already told about (here or by the background check)
  const notified = loadNotified()
  for (const id of await backgroundNotifiedIds()) notified.add(id)
  let firstRun = false
  try {
    firstRun = localStorage.getItem(LAST_CHECK) === null
  } catch {
    /* ignore */
  }
  const isNew = (s: Suggestion) => !s.messageId || !notified.has(s.messageId)
  const newAdded = autoAdded.filter(isNew)
  const toReview = final.filter((s) => s.status === 'new')
  const newReview = toReview.filter(isNew)
  if (opts.notify !== false && !firstRun && (newAdded.length || newReview.length)) {
    const title = newAdded.length
      ? `📬 Added ${newAdded.length} deadline${newAdded.length === 1 ? '' : 's'} from your email`
      : `📬 ${newReview.length} new deadline${newReview.length === 1 ? '' : 's'} from your email`
    const body = newAdded.length
      ? `${describeFinds(newAdded)}.${newReview.length ? ` ${newReview.length} more to review in the app.` : ''}`
      : `${describeFinds(newReview)}. Open the app to add ${newReview.length === 1 ? 'it' : 'them'}.`
    await notifyNow(title, body).catch(() => {})
  }
  for (const s of final) if (s.messageId) notified.add(s.messageId)
  saveNotified(notified)
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
