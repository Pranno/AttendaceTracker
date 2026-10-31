// EmailInbox — Section I: college email integration.
// Primary path: "Fetch from Gmail" (live OAuth + Gmail API, see logic/gmail.ts)
// turns recent messages into Suggestions you accept or dismiss (I3/I4).
// Fallback path: paste an email's text directly (works offline, zero setup).

import { useEffect, useState } from 'react'
import { Mail, RefreshCw, Check, X, Inbox, ClipboardPaste, Plug, Unplug } from 'lucide-react'
import { useApp } from '../data/store'
import { formatShort, todayStr } from '../logic/dates'
import type { Suggestion } from '../data/model'
import { extractDeadlines } from '../logic/deadlines'
import {
  beginLogin,
  beginLoginNative,
  completeLogin,
  completeLoginFromUrl,
  connectedEmail,
  disconnect,
  fetchInbox,
  hasGmailSetup,
  isConnected,
  loadGmailConfig,
  loadPendingNativeCode,
  parseMessages,
  toSuggestions,
} from '../logic/gmail'

export default function EmailInbox({ compact = false }: { compact?: boolean }) {
  const { data, addSuggestions, acceptSuggestion, dismissSuggestion, clearSeenSuggestions } = useApp()
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  // Native (Capacitor) redirect mode: window.location.href can't leave the app,
  // so we open Google's consent page in a system-browser tab and read the code
  // back from localStorage (see beginLoginNative / poll below).
  const nativeMode = typeof window !== 'undefined' && !/^https?:$/.test(window.location.protocol)

  const newOnes = data.suggestions.filter((s) => s.status === 'new')
  const handled = data.suggestions.filter((s) => s.status !== 'new')

  async function refreshAuthState() {
    setConnected(await isConnected())
    setEmail(await connectedEmail())
  }
  useEffect(() => {
    void refreshAuthState()
    // Web mode: if Google just redirected back with ?code=..., finish silently.
    if (window.location.search.includes('code=')) {
      void completeLoginFromUrl(window.location.search).then((ok) => {
        if (ok) void refreshAuthState()
      })
    }
    // Native mode: a deep link may have landed while the app was closed.
    const pending = loadPendingNativeCode()
    if (pending) {
      void completeLogin(pending).then((ok) => {
        if (ok) void refreshAuthState()
      })
    }
  }, [])

  async function handleFetch() {
    if (connected) {
      await doFetch()
      return
    }
    // Not connected yet: start OAuth first, fetch happens once it completes.
    const cfg = loadGmailConfig()
    if (!cfg) {
      setError('Add your Google Cloud Client ID in Settings → College email first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (nativeMode) {
        await beginLoginNative(cfg)
        setNote('Finish signing in in the browser — the app picks it up automatically when you return.')
        pollForCode()
      } else {
        window.location.href = await beginLogin(cfg)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start sign-in.')
    } finally {
      setBusy(false)
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null
  function pollForCode() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(async () => {
      const search = loadPendingNativeCode()
      if (!search) return
      clearInterval(pollTimer!)
      pollTimer = null
      const ok = await completeLogin(search)
      if (ok) {
        void refreshAuthState()
        setNote('Gmail connected!')
        await doFetch()
      } else {
        setError('Sign-in could not be completed. Try again.')
      }
    }, 1500)
  }
  useEffect(
    () => () => {
      if (pollTimer) clearInterval(pollTimer)
    },
    [],
  )

  async function doFetch() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const msgs = await fetchInbox(25)
      const parsed = parseMessages(msgs, data.subjects)
      const fresh = toSuggestions(parsed, data.suggestions)
      addSuggestions(fresh)
      setNote(
        fresh.length > 0
          ? `Checked ${msgs.length} recent emails — ${fresh.length} new suggestion${fresh.length === 1 ? '' : 's'}.`
          : `Checked ${msgs.length} recent emails — nothing new with a date in it.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Gmail.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    await disconnect()
    setNote('Gmail disconnected.')
    void refreshAuthState()
  }

  function handlePasteAdd() {
    if (!pasteText.trim()) return
    const items = extractDeadlines(pasteText, todayStr(), data.subjects)
    if (items.length === 0) {
      setError('No dates found in that text. Include the due date line.')
      return
    }
    const subs: Suggestion[] = items.map((d, i) => ({
      id: `sug_manual_${Date.now()}_${i}`,
      kind: 'deadline',
      title: d.title,
      date: d.dueDate,
      sourceSnippet: d.sourceLine.slice(0, 200),
      cameFrom: 'gmail',
      status: 'new',
    }))
    addSuggestions(subs)
    setPasteText('')
    setPasteOpen(false)
    setError(null)
    setNote(`${subs.length} suggestion${subs.length === 1 ? '' : 's'} added from pasted text.`)
  }

  const configured = hasGmailSetup()

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={18} />
        <h3 style={{ margin: 0, flex: 1 }}>College email</h3>
        {newOnes.length > 0 && (
          <span className="badge" aria-label={`${newOnes.length} new suggestions`}>
            {newOnes.length}
          </span>
        )}
      </div>

      {/* connection row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {connected ? (
          <>
            <span className="msg">
              Connected{email ? ` as ${email}` : ''}.
            </span>
            <button className="btn small" onClick={() => void handleFetch()} disabled={busy}>
              <RefreshCw size={14} className={busy ? 'spin' : undefined} /> {busy ? 'Checking…' : 'Fetch from Gmail'}
            </button>
            <button className="btn small ghost" onClick={() => void handleDisconnect()}>
              <Unplug size={14} /> Disconnect
            </button>
          </>
        ) : configured ? (
          <button className="btn small" onClick={() => void handleFetch()} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'spin' : undefined} /> Connect Gmail &amp; fetch
          </button>
        ) : (
          <span className="msg">
            <Plug size={14} style={{ verticalAlign: -2 }} /> To auto-read your college emails, add your Google Cloud
            Client ID in Settings → College email, then connect here.
          </span>
        )}
        <button className="btn small ghost" onClick={() => setPasteOpen((v) => !v)}>
          <ClipboardPaste size={14} /> Paste instead
        </button>
      </div>

      {pasteOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            rows={4}
            placeholder="Paste the email body here — lines with dates become suggestions."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <button className="btn small" onClick={handlePasteAdd} disabled={!pasteText.trim()}>
            Extract suggestions
          </button>
        </div>
      )}

      {error && <p className="msg danger" style={{ margin: 0 }}>{error}</p>}
      {note && <p className="msg" style={{ margin: 0 }}>{note}</p>}

      {/* suggestions list */}
      {newOnes.length === 0 && handled.length === 0 ? (
        <p className="msg" style={{ margin: 0 }}>
          <Inbox size={14} style={{ verticalAlign: -2 }} />{' '}
          {compact ? 'No pending email suggestions. Open College email in Settings to connect Gmail or paste a notice.' : 'No pending suggestions. Fetch Gmail or paste an email above.'}
        </p>
      ) : newOnes.length === 0 ? null : (
        <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {newOnes.map((s) => (
            <li key={s.id} className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{s.title}</strong>
                <div className="msg">
                  Due {s.date ? formatShort(s.date) : '—'} · from {s.sourceSnippet.slice(0, 60)}
                </div>
              </div>
              <button className="btn small" title="Add as deadline" onClick={() => acceptSuggestion(s.id)}>
                <Check size={14} /> Add
              </button>
              <button className="btn small ghost" title="Dismiss" onClick={() => dismissSuggestion(s.id)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {handled.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="msg">
            {handled.filter((s) => s.status === 'added').length} added · {handled.filter((s) => s.status === 'dismissed').length} dismissed
          </span>
          <button className="btn small ghost" onClick={clearSeenSuggestions}>
            Clear history
          </button>
        </div>
      )}
    </div>
  )
}
