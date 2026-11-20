// College-email integration (Section I) — LIVE GMAIL FIRST, PASTE AS FALLBACK.
// Sign-in: in the Android app, native Google sign-in (gmailNative.ts →
// GmailAuthPlugin.java); in the web build, OAuth 2.0 Authorization Code +
// PKCE with a redirect (no backend needed; tokens encrypted at rest by
// tokenCrypto.ts). Recent mail is then read from the Gmail REST API with the
// gmail.readonly scope and fed through the chosen deadline reader.
// Fallback path: PasteDeadlineSheet (zero setup, works offline).

import { extractDeadlines, type ExtractedDeadline } from './deadlines'
import { readDeadlinesFromMessages, type DeadlineReader } from './smartDeadlines'
import { categorize } from './deadlineCategory'
import { fromDate, todayStr } from './dates'
import { clearEncrypted, decryptJson, encryptJson } from './tokenCrypto'
import { nativeSignOut, nativeStatus, nativeToken, useNativeGmail } from './gmailNative'
import type { DateStr, Suggestion, Subject } from '../data/model'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

const CFG_KEY = 'at.gmail.clientid.v1'

export interface GmailConfig {
  clientId: string
  redirectUri: string
}

/** Web build only: must match an Authorized redirect URI in Google Cloud
 *  Console (the Android app signs in natively — see gmailNative.ts). */
export function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin + window.location.pathname
}

export function loadGmailConfig(): GmailConfig | null {
  const clientId = localStorage.getItem(CFG_KEY)?.trim()
  if (!clientId) return null
  return { clientId, redirectUri: defaultRedirectUri() }
}

export function saveGmailConfig(clientId: string): void {
  localStorage.setItem(CFG_KEY, clientId.trim())
}

export function hasGmailSetup(): boolean {
  // The Android app signs in natively (no client ID to paste).
  return useNativeGmail() || loadGmailConfig() !== null
}

// ---------- PKCE helpers ----------

function b64url(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return b64url(new Uint8Array(digest))
}

function randomVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

// ---------- token store ----------

interface TokenBundle {
  access: string
  refresh: string
  /** ms epoch when the access token expires */
  exp: number
  email?: string
}

export async function getTokens(): Promise<TokenBundle | null> {
  return decryptJson<TokenBundle>()
}

export async function isConnected(): Promise<boolean> {
  if (useNativeGmail()) return (await nativeStatus()).connected
  const t = await getTokens()
  return !!t && (!!t.access || !!t.refresh)
}

export async function disconnect(): Promise<void> {
  if (useNativeGmail()) await nativeSignOut()
  await clearEncrypted()
}

async function refreshAccessToken(bundle: TokenBundle, cfg: GmailConfig): Promise<TokenBundle> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: 'refresh_token',
      refresh_token: bundle.refresh,
    }),
  })
  if (!res.ok) throw new Error(`Google refused to refresh the token (${res.status}). Reconnect your account in Settings.`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  const next: TokenBundle = { ...bundle, access: j.access_token, exp: Date.now() + j.expires_in * 1000 - 60_000 }
  await encryptJson(next)
  return next
}

async function getFreshToken(cfg: GmailConfig): Promise<string> {
  const bundle = await getTokens()
  if (!bundle) throw new Error('Not connected to Gmail.')
  if (bundle.access && Date.now() < bundle.exp) return bundle.access
  if (bundle.refresh) return (await refreshAccessToken(bundle, cfg)).access
  throw new Error('Session expired. Reconnect your account in Settings.')
}

// ---------- login flow ----------

const PKCE_VERIFIER_KEY = 'at.gmail.pkce.v1'
const PKCE_STATE_KEY = 'at.gmail.state.v1'

/** Build the consent URL and remember verifier/state. Caller navigates there. */
export async function beginLogin(cfg: GmailConfig): Promise<string> {
  const verifier = randomVerifier()
  const state = randomVerifier()
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  sessionStorage.setItem(PKCE_STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: `${GMAIL_SCOPE} email`,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

/** Exchange an authorization code (from the redirect URL) for tokens. */
export async function completeLogin(search: string): Promise<boolean> {
  const q = new URLSearchParams(search)
  const code = q.get('code')
  const state = q.get('state')
  if (!code || !state) return false
  let savedState = sessionStorage.getItem(PKCE_STATE_KEY)
  let verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY)
  if (!verifier || !savedState) {
    savedState = localStorage.getItem(PKCE_STATE_KEY)
    verifier = localStorage.getItem(PKCE_VERIFIER_KEY)
  }
  sessionStorage.removeItem(PKCE_STATE_KEY)
  sessionStorage.removeItem(PKCE_VERIFIER_KEY)
  localStorage.removeItem(PKCE_STATE_KEY)
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  if (!verifier || state !== savedState) return false // possible CSRF — ignore
  const cfg = loadGmailConfig()
  if (!cfg) return false

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) return false
  const j = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    id_token?: string
  }
  let email: string | undefined
  try {
    if (j.id_token) email = (JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string }).email
  } catch {
    /* id_token optional */
  }
  await encryptJson({
    access: j.access_token,
    refresh: j.refresh_token ?? '',
    exp: Date.now() + j.expires_in * 1000 - 60_000,
    email,
  } satisfies TokenBundle)
  return true
}

/** Web-mode convenience: consume ?code=... from the current page URL. */
export async function completeLoginFromUrl(search: string): Promise<boolean> {
  const q = new URLSearchParams(search)
  if (q.get('error')) {
    history.replaceState({}, '', window.location.pathname)
    return false
  }
  const ok = await completeLogin(search)
  if (ok || q.get('code')) history.replaceState({}, '', window.location.pathname)
  return ok
}

export async function connectedEmail(): Promise<string | null> {
  if (useNativeGmail()) return (await nativeStatus()).email
  return (await getTokens())?.email ?? null
}

// ---------- fetching & parsing ----------

export interface InboxMessage {
  id: string
  subject: string
  /** "Exam Cell <exams@college.ac.in>" */
  from: string
  snippet: string
  body: string
  date: DateStr
}

interface RawPart {
  mimeType?: string
  filename?: string
  headers?: { name?: string; value?: string }[]
  parts?: RawPart[]
  body?: { data?: string }
}

function decodeB64url(data: string): string {
  const norm = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bin = atob(norm)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walkParts(parts: RawPart[], out: { plain: string; html: string }): void {
  for (const p of parts) {
    if (p.filename) continue // skip attachments
    if (p.parts) walkParts(p.parts, out)
    else if (p.mimeType === 'text/plain' && p.body?.data) out.plain += decodeB64url(p.body.data)
    else if (p.mimeType === 'text/html' && p.body?.data) out.html += decodeB64url(p.body.data)
  }
}

function parseMessage(msg: { id: string; snippet?: string; internalDate?: string; payload?: RawPart }): InboxMessage {
  const headers = msg.payload?.headers ?? []
  const get = (name: string) => headers.find((h) => h.name?.toLowerCase() === name)?.value ?? ''
  const found = { plain: '', html: '' }
  if (msg.payload?.parts) walkParts(msg.payload.parts, found)
  else if (msg.payload?.body?.data) {
    const raw = decodeB64url(msg.payload.body.data)
    if (msg.payload.mimeType === 'text/html') found.html = raw
    else found.plain = raw
  }
  const body = found.plain.trim() ? found.plain : stripHtml(found.html)
  const ts = Number(msg.internalDate ?? Date.now())
  return {
    id: msg.id,
    subject: get('subject'),
    from: get('from'),
    snippet: msg.snippet ?? '',
    body,
    date: fromDate(new Date(ts)),
  }
}

/** Fetch the most recent `max` messages and parse deadline candidates from each. */
export async function fetchInbox(max = 25, cfg = loadGmailConfig()): Promise<InboxMessage[]> {
  const native = useNativeGmail()
  if (!native && !cfg) throw new Error('Gmail is not set up. Add your Google Cloud Client ID in Settings first.')
  let token = native ? await nativeToken() : await getFreshToken(cfg!)
  const list1 = () => fetch(`${API_BASE}/messages?maxResults=${max}`, { headers: { Authorization: `Bearer ${token}` } })
  let listRes = await list1()
  if (listRes.status === 401 && native) {
    // a cached token Google no longer accepts — get a fresh one once
    token = await nativeToken(true)
    listRes = await list1()
  }
  if (listRes.status === 401) throw new Error('Gmail session expired — reconnect your account in Settings.')
  if (!listRes.ok) {
    // Show Google's own reason (e.g. "Gmail API has not been used in project … or it is disabled",
    // "Request had insufficient authentication scopes") — a bare status code isn't fixable.
    let why = ''
    try {
      const j = (await listRes.json()) as { error?: { message?: string; status?: string } }
      why = j.error?.message ?? j.error?.status ?? ''
    } catch {
      /* no JSON body */
    }
    throw new Error(`Could not load messages (${listRes.status})${why ? `: ${why}` : '.'}`)
  }
  const list = (await listRes.json()) as { messages?: { id: string }[] }
  const ids = (list.messages ?? []).map((m) => m.id)
  const msgs = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${API_BASE}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) return null
      return parseMessage(await r.json())
    }),
  )
  return msgs.filter((m): m is InboxMessage => !!m)
}

export interface ParsedMessage {
  message: InboxMessage
  items: ExtractedDeadline[]
}

export function parseMessages(messages: InboxMessage[], subjects: Subject[]): ParsedMessage[] {
  return messages.map((m) => ({
    message: m,
    items: extractDeadlines([m.subject, m.body].filter(Boolean).join('\n'), todayStr(), subjects),
  })).filter((p) => p.items.length > 0)
}

/** Same as parseMessages, with the reader chosen in Settings (Smart reads
 *  all the emails in one Gemini request; falls back to Standard). */
export async function parseMessagesWith(
  messages: InboxMessage[],
  subjects: Subject[],
  reader: DeadlineReader,
): Promise<{ parsed: ParsedMessage[]; reader: DeadlineReader; fallbackReason?: string }> {
  const res = await readDeadlinesFromMessages(
    messages.map((m) => ({ id: m.id, text: [m.subject, m.body].filter(Boolean).join('\n') })),
    todayStr(),
    subjects,
    reader,
  )
  const parsed = messages
    .map((m) => ({ message: m, items: res.byId.get(m.id) ?? [] }))
    .filter((p) => p.items.length > 0)
  return { parsed, reader: res.reader, fallbackReason: res.fallbackReason }
}

/** Turn parsed hits into pending Suggestions (dedup by gmail message id, I3). */
export function toSuggestions(parsed: ParsedMessage[], existing: Suggestion[], subjects: Subject[] = []): Suggestion[] {
  // The parser already names the subject (its short name); attach the id so
  // an accepted suggestion becomes a deadline under that subject.
  const idByShort = new Map(subjects.map((s) => [s.shortName.toUpperCase(), s.id]))
  const seenMsgIds = new Set(existing.map((s) => s.messageId).filter(Boolean))
  const out: Suggestion[] = []
  for (const p of parsed) {
    if (seenMsgIds.has(p.message.id)) continue
    p.items.forEach((d, i) => {
      out.push({
        id: `sug_${p.message.id}_${i}`,
        kind: 'deadline',
        title: d.title,
        category: d.category ?? categorize(d.title, d.sourceLine, p.message.subject),
        from: p.message.from || undefined,
        subjectId: d.subjectHint ? idByShort.get(d.subjectHint.toUpperCase()) : undefined,
        date: d.dueDate,
        sourceSnippet: `${p.message.subject ? p.message.subject + ' — ' : ''}${d.sourceLine}`.slice(0, 200),
        cameFrom: 'gmail',
        messageId: p.message.id,
        status: 'new',
      })
    })
  }
  return out
}
