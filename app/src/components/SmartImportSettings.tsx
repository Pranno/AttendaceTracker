// Settings → Smart import (AI): the user's own Gemini API key, a step-by-step
// guide to getting one, a test button and the model choice. The key stays on
// this phone only (not in the app data, so never in an exported backup).

import { useState } from 'react'
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound } from 'lucide-react'
import {
  AI_STUDIO_KEY_URL,
  DEFAULT_GEMINI_MODEL,
  getGeminiKey,
  getGeminiModel,
  listGeminiModels,
  maskKey,
  setGeminiKey,
  setGeminiModel,
  type GeminiModel,
} from '../logic/gemini'
import { openExternal } from './Locker'

export default function SmartImportSettings() {
  const [saved, setSaved] = useState(getGeminiKey())
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [models, setModels] = useState<GeminiModel[]>([])
  const [model, setModel] = useState(getGeminiModel())
  const [guideOpen, setGuideOpen] = useState(!getGeminiKey())

  async function test(key: string) {
    setBusy(true)
    setStatus(null)
    try {
      const list = await listGeminiModels(key)
      setModels(list)
      if (list.length && !list.some((m) => m.id === model)) {
        // the saved model isn't offered to this key — use the best available
        setModel(list[0].id)
        setGeminiModel(list[0].id)
      }
      setStatus({ ok: true, text: `Key works — ${list.length} model${list.length === 1 ? '' : 's'} available.` })
      return true
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'Could not check the key.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveAndTest() {
    const k = draft.trim()
    if (!k) return
    setGeminiKey(k)
    setSaved(k)
    setDraft('')
    setShow(false)
    if (await test(k)) setGuideOpen(false)
  }

  function remove() {
    if (!window.confirm('Remove your Gemini API key from this phone? Smart import will stop working until you add one again.')) return
    setGeminiKey('')
    setSaved('')
    setModels([])
    setStatus(null)
    setGuideOpen(true)
  }

  return (
    <div className="card smart-settings">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <KeyRound size={22} style={{ flex: 'none', marginTop: 2, color: 'var(--primary)' }} />
        <div className="msg" style={{ color: 'var(--text)' }}>
          Smart import uses Google’s <b>Gemini</b> AI to read your timetable and syllabus PDFs (or photos) — any layout,
          in full detail. It needs your own free Gemini API key.
        </div>
      </div>

      {saved ? (
        <div className="smart-key-row">
          <span className="grow">
            <b>Key saved</b> <span className="msg">({maskKey(saved)})</span>
          </span>
          <button onClick={() => void test(saved)} disabled={busy}>{busy ? 'Checking…' : 'Test'}</button>
          <button className="danger-quiet" onClick={remove}>Remove</button>
        </div>
      ) : (
        <div className="msg" style={{ marginTop: 10 }}>No key added yet.</div>
      )}

      {status && (
        <div className={`smart-status ${status.ok ? 'ok' : 'bad'}`}>
          {status.ok && <CheckCircle2 size={16} />} {status.text}
        </div>
      )}

      {saved && models.length > 0 && (
        <label className="smart-model">
          <span className="small-label">Model</span>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setGeminiModel(e.target.value)
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}{m.id === DEFAULT_GEMINI_MODEL ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <button className="link-btn" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setGuideOpen((o) => !o)}>
        {guideOpen ? 'Hide' : 'How do I get a Gemini API key?'}
      </button>

      {guideOpen && (
        <ol className="smart-guide">
          <li>
            Open <b>Google AI Studio</b>:
            <button className="secondary smart-guide-btn" onClick={() => void openExternal(AI_STUDIO_KEY_URL)}>
              <ExternalLink size={16} /> Open Google AI Studio
            </button>
          </li>
          <li>Sign in with your Google account (your normal Gmail works) and accept the terms if it asks.</li>
          <li>
            Tap <b>Create API key</b>. If it asks for a project, choose the one it suggests or create a new one — the
            default is fine.
          </li>
          <li>
            Tap <b>Copy</b> next to the new key. It is a long code that usually starts with <code>AIza</code>.
          </li>
          <li>Come back here, paste it in the box below and tap <b>Save &amp; test</b>.</li>
        </ol>
      )}

      <div className="smart-key-input">
        <input
          type={show ? 'text' : 'password'}
          placeholder={saved ? 'Paste a new key to replace it' : 'Paste your Gemini API key'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label="Gemini API key"
        />
        <button className="icon-btn small" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide key' : 'Show key'}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={() => void saveAndTest()} disabled={!draft.trim() || busy}>
        Save &amp; test
      </button>

      <ul className="smart-notes msg">
        <li>The free tier has daily limits — plenty for importing a timetable and a few syllabi.</li>
        <li>
          On the free tier Google may use what you upload to improve its products. Timetables and syllabi are fine; don’t
          upload private documents.
        </li>
        <li>Keep the key private — anyone with it can use your limit. You can delete it any time in Google AI Studio.</li>
        <li>The key is stored only on this phone and is not included in data exports.</li>
      </ul>
    </div>
  )
}
