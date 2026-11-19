// ============================================================
// Locker tab — a store room per subject.
//  • Subject grid (tiles with counts) + search across every subject
//  • Inside a subject, two sub-tabs:
//      Notes — messages you want to keep, shown IN FULL as chat bubbles
//              (never cut short), with sort / pinned filters
//      Links — course links with Open + a "completed" checkbox and progress
// Notes and links live in the normal app data, so Export / Restore backup
// carries them. (Files are the next phase.)
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowLeft, Check, ClipboardPaste, Copy, ExternalLink, Pencil, Pin, PinOff, Search, Send, Trash2 } from 'lucide-react'
import { useApp } from '../data/store'
import type { CourseLink, Note, Subject } from '../data/model'
import { normalizeUrl } from '../logic/courseLinks'
import { formatShort, todayStr } from '../logic/dates'
import { subjectTileStyle } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { SectionTitle } from './ui/parts'

// ---------- helpers ----------

/** Open a link outside the app: the system browser on Android (the WebView
 *  can't show other sites), a new tab on the web. */
export async function openExternal(url: string): Promise<void> {
  const u = normalizeUrl(url)
  if (!u) return
  if (Capacitor.isNativePlatform()) {
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url: u })
      return
    } catch {
      /* fall back below */
    }
  }
  window.open(u, '_blank', 'noopener')
}

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi

/** Note text with tappable links; everything else kept exactly as typed. */
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    // trailing punctuation is usually not part of the link
    const raw = m[0].replace(/[),.;:!?]+$/, '')
    parts.push(
      <a
        key={i}
        href={normalizeUrl(raw)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void openExternal(raw)
        }}
      >
        {raw}
      </a>,
    )
    last = i + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function noteTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  return date === todayStr() ? `Today, ${time}` : `${formatShort(date, d.getFullYear() !== new Date().getFullYear())}, ${time}`
}

function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const isDone = (c: CourseLink) => c.status === 'completed'

// ---------- main tab ----------

export default function Locker() {
  const { data } = useApp()
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const subject = data.subjects.find((s) => s.id === openId)

  // a deleted subject closes its view
  useEffect(() => {
    if (openId && !subject) setOpenId(null)
  }, [openId, subject])

  if (subject) return <SubjectLocker subject={subject} onBack={() => setOpenId(null)} />
  return <LockerHome query={query} setQuery={setQuery} onOpen={setOpenId} />
}

function LockerHome({ query, setQuery, onOpen }: { query: string; setQuery: (q: string) => void; onOpen: (id: string) => void }) {
  const { data } = useApp()
  const { active } = useTheme()
  const q = query.trim().toLowerCase()

  const results = useMemo(() => {
    if (!q) return null
    const subj = new Map(data.subjects.map((s) => [s.id, s]))
    const notes = data.notes
      .filter((n) => subj.has(n.subjectId) && n.text.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const links = data.courseLinks.filter(
      (c) => subj.has(c.subjectId) && (c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)),
    )
    return { notes, links, subj }
  }, [q, data.notes, data.courseLinks, data.subjects])

  return (
    <div className="screen pad locker">
      <h1 style={{ margin: '8px 0 4px' }}>Locker</h1>
      <div className="msg" style={{ marginBottom: 10 }}>Notes and course links for each subject, kept in one place.</div>

      <label className="locker-search">
        <Search size={18} aria-hidden />
        <input
          type="search"
          placeholder="Search all notes and links"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {results ? (
        <>
          <SectionTitle>NOTES · {results.notes.length}</SectionTitle>
          {results.notes.length === 0 && <div className="card msg">No notes match.</div>}
          {results.notes.map((n) => (
            <button key={n.id} className="card search-hit" onClick={() => onOpen(n.subjectId)}>
              <b>{results.subj.get(n.subjectId)?.shortName}</b>
              <span className="msg"> · {noteTime(n.createdAt)}</span>
              <div className="note-text clamp">{n.text}</div>
            </button>
          ))}
          <SectionTitle>LINKS · {results.links.length}</SectionTitle>
          {results.links.length === 0 && <div className="card msg">No links match.</div>}
          {results.links.map((c) => (
            <button key={c.id} className="card search-hit" onClick={() => onOpen(c.subjectId)}>
              <b>{results.subj.get(c.subjectId)?.shortName}</b>
              <span className="msg"> · {c.name}</span>
            </button>
          ))}
        </>
      ) : data.subjects.length === 0 ? (
        <div className="card empty-card">🗄️ No subjects yet — add your timetable first, then each subject gets its own locker.</div>
      ) : (
        <div className="locker-grid">
          {data.subjects.map((s, i) => {
            const notes = data.notes.filter((n) => n.subjectId === s.id).length
            const links = data.courseLinks.filter((c) => c.subjectId === s.id)
            const done = links.filter(isDone).length
            return (
              <button key={s.id} className="locker-tile card-like" style={subjectTileStyle(i, active)} onClick={() => onOpen(s.id)}>
                <span className="locker-tile-short" style={{ color: 'var(--subj-strong)' }}>{s.shortName}</span>
                <span className="locker-tile-full">{s.fullName !== s.shortName ? s.fullName : ''}</span>
                <span className="locker-tile-count">
                  {notes} note{notes === 1 ? '' : 's'}
                  {links.length > 0 ? ` · ${done}/${links.length} links` : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- one subject ----------

function SubjectLocker({ subject, onBack }: { subject: Subject; onBack: () => void }) {
  const { data } = useApp()
  const [part, setPart] = useState<'notes' | 'links'>('notes')
  const noteCount = data.notes.filter((n) => n.subjectId === subject.id).length
  const links = data.courseLinks.filter((c) => c.subjectId === subject.id)

  return (
    <div className="screen pad locker">
      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back to all subjects">
          <ArrowLeft size={20} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{subject.shortName}</h1>
          {subject.fullName !== subject.shortName && <div className="msg">{subject.fullName}</div>}
        </div>
      </div>

      <div className="row locker-parts" role="tablist">
        <button role="tab" aria-selected={part === 'notes'} className={`chip grow${part === 'notes' ? ' on' : ''}`} onClick={() => setPart('notes')}>
          Notes · {noteCount}
        </button>
        <button role="tab" aria-selected={part === 'links'} className={`chip grow${part === 'links' ? ' on' : ''}`} onClick={() => setPart('links')}>
          Links · {links.filter(isDone).length}/{links.length}
        </button>
      </div>

      {part === 'notes' ? <NotesPart subject={subject} /> : <LinksPart subject={subject} />}
    </div>
  )
}

// ---------- Notes ----------

type Order = 'oldest' | 'newest'

function NotesPart({ subject }: { subject: Subject }) {
  const { data, addNote } = useApp()
  const [order, setOrder] = useState<Order>(() => {
    try {
      return localStorage.getItem('at.locker.order') === 'newest' ? 'newest' : 'oldest'
    } catch {
      return 'oldest'
    }
  })
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [find, setFind] = useState('')
  const [draft, setDraft] = useState('')
  const [pasteHint, setPasteHint] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem('at.locker.order', order)
    } catch {
      /* ignore */
    }
  }, [order])

  const all = data.notes.filter((n) => n.subjectId === subject.id)
  const f = find.trim().toLowerCase()
  const shown = all
    .filter((n) => !pinnedOnly || n.pinned)
    .filter((n) => !f || n.text.toLowerCase().includes(f))
    .sort((a, b) => (order === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)))

  // Chat order: the newest message (and the box to add one) sit at the bottom.
  useEffect(() => {
    if (order === 'oldest') endRef.current?.scrollIntoView({ block: 'end' })
  }, [order, all.length])

  async function pasteFromClipboard() {
    setPasteHint(null)
    try {
      const t = await navigator.clipboard.readText()
      if (t) setDraft((d) => (d ? `${d}\n${t}` : t))
      else setPasteHint('Clipboard is empty.')
    } catch {
      setPasteHint('Long-press the box and choose Paste.')
    }
  }

  function save() {
    if (!draft.trim()) return
    addNote(subject.id, draft)
    setDraft('')
    setPasteHint(null)
  }

  const composer = (
    <div className="card note-composer">
      <textarea
        placeholder="Paste or type something to keep…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={draft.split('\n').length > 3 ? 6 : 3}
      />
      {pasteHint && <div className="msg">{pasteHint}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="secondary grow" onClick={() => void pasteFromClipboard()}>
          <ClipboardPaste size={16} /> Paste
        </button>
        <button className="primary grow" onClick={save} disabled={!draft.trim()}>
          <Send size={16} /> Save
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* filter / sort bar */}
      <div className="note-filters">
        <select value={order} onChange={(e) => setOrder(e.target.value as Order)} aria-label="Order">
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
        <button className={`chip${pinnedOnly ? ' on' : ''}`} onClick={() => setPinnedOnly((p) => !p)}>
          📌 Pinned
        </button>
        <input type="search" placeholder="Find…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find in notes" />
      </div>

      {order === 'newest' && composer}

      {all.length === 0 && <div className="card empty-card">Nothing saved for {subject.shortName} yet. Paste a message below to keep it here.</div>}
      {all.length > 0 && shown.length === 0 && <div className="card msg">No notes match this filter.</div>}

      <div className="note-list">
        {shown.map((n) => (
          <NoteBubble key={n.id} note={n} selected={selected === n.id} onSelect={() => setSelected(selected === n.id ? null : n.id)} />
        ))}
      </div>

      {order === 'oldest' && composer}
      <div ref={endRef} />
    </>
  )
}

function NoteBubble({ note, selected, onSelect }: { note: Note; selected: boolean; onSelect: () => void }) {
  const { updateNote, deleteNote } = useApp()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const [copied, setCopied] = useState(false)

  if (editing) {
    return (
      <div className="note-bubble editing">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, text.split('\n').length + 1)} autoFocus />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="grow" onClick={() => { setText(note.text); setEditing(false) }}>Cancel</button>
          <button
            className="primary grow"
            disabled={!text.trim()}
            onClick={() => {
              updateNote(note.id, { text: text.trim() })
              setEditing(false)
            }}
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`note-bubble${note.pinned ? ' pinned' : ''}${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="note-text">
        <Linkified text={note.text} />
      </div>
      <div className="note-meta">
        {note.pinned && <span aria-label="Pinned">📌</span>}
        {noteTime(note.createdAt)}
        {note.editedAt ? ' · edited' : ''}
      </div>
      {selected && (
        <div className="note-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => updateNote(note.id, { pinned: !note.pinned })}>
            {note.pinned ? <PinOff size={16} /> : <Pin size={16} />} {note.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(note.text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                /* clipboard blocked */
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => { setText(note.text); setEditing(true) }}>
            <Pencil size={16} /> Edit
          </button>
          <button className="danger-quiet" onClick={() => { if (window.confirm('Delete this note?')) deleteNote(note.id) }}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Links ----------

function LinksPart({ subject }: { subject: Subject }) {
  const { data, addCourseLink, setCourseStatus, deleteCourseLink } = useApp()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const links = data.courseLinks.filter((c) => c.subjectId === subject.id)
  const done = links.filter(isDone).length

  // Keep imported unit grouping when links have it; otherwise one plain list.
  const groups = useMemo(() => {
    const m = new Map<string, CourseLink[]>()
    for (const c of links) {
      const k = c.unitTitle ?? ''
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(c)
    }
    return [...m.entries()]
  }, [links])

  function add() {
    const u = normalizeUrl(url)
    const host = hostOf(u)
    if (!u || !host || !host.includes('.')) {
      setErr('That doesn’t look like a link.')
      return
    }
    addCourseLink({
      subjectId: subject.id,
      name: name.trim() || host,
      platform: host,
      url: u,
      status: 'not started',
      needsChecking: false,
    })
    setUrl('')
    setName('')
    setErr(null)
  }

  return (
    <>
      {links.length > 0 && (
        <div className="card link-progress">
          <div className="row spread">
            <b>{done} of {links.length} done</b>
            <span className="msg">{Math.round((done / links.length) * 100)}%</span>
          </div>
          <div className="bar"><span style={{ width: `${(done / links.length) * 100}%` }} /></div>
        </div>
      )}

      {links.length === 0 && <div className="card empty-card">No links for {subject.shortName} yet. Add your course links below.</div>}

      {groups.map(([unit, list]) => (
        <div key={unit || '_'}>
          {unit && <SectionTitle>{unit}</SectionTitle>}
          {list.map((c) => (
            <div key={c.id} className={`card link-row${isDone(c) ? ' done' : ''}`}>
              <label className="link-check" aria-label={isDone(c) ? 'Mark not completed' : 'Mark completed'}>
                <input
                  type="checkbox"
                  checked={isDone(c)}
                  onChange={(e) => setCourseStatus(c.id, e.target.checked ? 'completed' : 'not started', todayStr())}
                />
              </label>
              <button className="link-main" onClick={() => c.url && void openExternal(c.url)} disabled={!c.url}>
                <span className="link-name">{c.name}</span>
                <span className="msg">
                  {c.url ? hostOf(c.url) : 'no link yet'}
                  {isDone(c) && c.completedDate ? ` · done ${formatShort(c.completedDate)}` : ''}
                </span>
              </button>
              {c.url && (
                <button className="icon-btn small" onClick={() => void openExternal(c.url)} aria-label={`Open ${c.name}`}>
                  <ExternalLink size={16} />
                </button>
              )}
              <button
                className="icon-btn small"
                onClick={() => { if (window.confirm(`Remove “${c.name}”?`)) deleteCourseLink(c.id) }}
                aria-label={`Remove ${c.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      ))}

      <SectionTitle>ADD A LINK</SectionTitle>
      <div className="card">
        <input type="url" inputMode="url" placeholder="Paste the link (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={{ marginTop: 8 }} />
        {err && <div className="msg" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</div>}
        <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={add} disabled={!url.trim()}>
          Add link
        </button>
      </div>
    </>
  )
}
