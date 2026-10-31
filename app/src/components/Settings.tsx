// Settings — Step 2 design: soft grouped rounded lists; the threshold as a big
// number with a slider and an emoji (F1); assumed past attendance the same way
// (F10); semester dates as two rounded date fields (F5); the theme picker as
// three preview tiles (F9); reminder lead time (F3); delete all data with a
// second tap to confirm (F8).

import { useState } from 'react'
import { useApp } from '../data/store'
import { exportData } from '../data/storage'
import { SliderField, SectionTitle, Toggle } from './ui/parts'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeChoice } from '../theme/ThemeProvider'
import { THEME_TOKENS } from '../theme/tokens'
import { extractDeadlines, type ExtractedDeadline } from '../logic/deadlines'
import { todayStr, formatShort } from '../logic/dates'
import EmailInbox from './EmailInbox'
import { defaultRedirectUri, loadGmailConfig, saveGmailConfig } from '../logic/gmail'

// ------------------------------------------------------------
// Deadline paste extraction (D-series): paste a class-group message,
// preview detected deadlines, edit/select, then save the chosen ones.
// ------------------------------------------------------------
function DeadlinePaste() {
  const { data, addDeadline } = useApp()
  const [text, setText] = useState('')
  const [results, setResults] = useState<ExtractedDeadline[] | null>(null)
  const [checked, setChecked] = useState<boolean[]>([])
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  function run() {
    const r = extractDeadlines(text, todayStr(), data.subjects)
    setResults(r)
    setChecked(r.map(() => true))
    setSavedMsg(null)
  }

  function save() {
    if (!results) return
    let n = 0
    results.forEach((d, i) => {
      if (!checked[i]) return
      // match subject hint to an existing subject id when possible
      const sub = d.subjectHint
        ? data.subjects.find(
            (s) => s.shortName.toLowerCase() === d.subjectHint!.toLowerCase() ||
                   s.fullName.toLowerCase().includes(d.subjectHint!.toLowerCase()),
          )
        : undefined
      addDeadline({
        title: d.title,
        dueDate: d.dueDate,
        subjectId: sub?.id,
        tentative: d.tentative,
        sourceText: text.slice(0, 500),
      })
      n++
    })
    setSavedMsg(n > 0 ? `Saved ${n} deadline${n === 1 ? '' : 's'} ✓` : 'Nothing selected.')
    setResults(null)
    setText('')
  }

  return (
    <div className="paste-box" style={{ marginBottom: 16 }}>
      <textarea
        placeholder={'Paste the WhatsApp / notice message here…\ne.g. "DSA assignment submission on 5/11"'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button className="secondary big-btn grow" disabled={text.trim().length < 4} onClick={run}>
          Extract deadlines
        </button>
        {results && (
          <button className="danger-quiet big-btn" onClick={() => { setResults(null); setText('') }}>
            Clear
          </button>
        )}
      </div>

      {savedMsg && <div className="msg" style={{ marginTop: 8 }}>{savedMsg}</div>}

      {results && (
        <div style={{ marginTop: 12 }}>
          {results.length === 0 && (
            <div className="card msg">No deadlines detected — check the message has a date + words like "submission", "due", "test".</div>
          )}
          {results.map((d, i) => (
            <div key={i} className="card extract-item">
              <button
                className={`extract-check${checked[i] ? ' on' : ''}`}
                aria-label={checked[i] ? 'Skip this one' : 'Include this one'}
                onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              >
                {checked[i] ? '✓' : ''}
              </button>
              <div className="extract-main">
                <input
                  className="extract-title-input"
                  value={d.title}
                  onChange={(e) => setResults((rs) => rs!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <div className="extract-meta">
                  Due {formatShort(d.dueDate)}
                  {d.subjectHint ? ` · ${d.subjectHint}` : ''}
                  {d.tentative ? ' · next year?' : ''}
                </div>
              </div>
              <input
                type="date"
                className="extract-date"
                value={d.dueDate}
                onChange={(e) =>
                  setResults((rs) => rs!.map((x, j) => (j === i ? { ...x, dueDate: e.target.value as ExtractedDeadline['dueDate'], tentative: false } : x)))
                }
              />
            </div>
          ))}
          {results.length > 0 && (
            <button className="primary big-btn grow" style={{ marginTop: 6 }} onClick={save}>
              Save {checked.filter(Boolean).length} selected
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function thresholdEmoji(n: number): string {
  if (n >= 90) return '🎯'
  if (n >= 75) return '🙂'
  if (n >= 60) return '😬'
  return '😱'
}

/** "A1" -> "A"; "" -> "". */
function divisionOf(batch: string): string {
  const m = /^([A-Za-z])/.exec(batch.trim())
  return m ? m[1].toUpperCase() : ''
}

/** "A1" -> "1"; "A" -> ""; "" -> "". */
function batchNumberOf(batch: string): string {
  const m = /^[A-Za-z]\s*[-_ ]?(\d+)?$/.exec(batch.trim())
  return m && m[1] ? m[1] : ''
}

function joinBatch(div: string, num: string): string {
  return div ? `${div}${num}` : ''
}

/** Effective division letter: the standalone myDivision setting, falling back
 *  to the letter inside myBatch (older saved data only had myBatch). */
function effDivision(s: { myDivision?: string; myBatch: string }): string {
  const d = (s.myDivision ?? '').trim().toUpperCase()
  return d || divisionOf(s.myBatch)
}

export default function Settings() {
  const { data, updateSettings, resetAll, addHoliday, deleteHoliday } = useApp()
  const { choice, setChoice } = useTheme()
  const s = data.settings
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Semester dates (F5): local draft so typing one field doesn't clobber the
  // other; applied together by the Save button (or auto when both are valid).
  const [semStart, setSemStart] = useState(s.semesterStart ?? '')
  const [semEnd, setSemEnd] = useState(s.semesterEnd ?? '')
  const [semSaved, setSemSaved] = useState(false)
  const semValid = !!semStart && !!semEnd && semEnd >= semStart
  const semDirty = semStart !== (s.semesterStart ?? '') || semEnd !== (s.semesterEnd ?? '')

  function saveSemesterDates() {
    if (!semValid) return
    updateSettings({ semesterStart: semStart, semesterEnd: semEnd })
    setSemSaved(true)
    window.setTimeout(() => setSemSaved(false), 2500)
  }

  // Holidays & exam days (A12)
  const [holLabel, setHolLabel] = useState('')
  const [holStart, setHolStart] = useState('')
  const [holEnd, setHolEnd] = useState('')
  const [holIsExam, setHolIsExam] = useState(false)

  const themes: { id: ThemeChoice; label: string; tokens: 'sunrise' | 'midnight' | null }[] = [
    { id: 'sunrise', label: 'Sunrise', tokens: 'sunrise' },
    { id: 'midnight', label: 'Midnight', tokens: 'midnight' },
    { id: 'system', label: 'Follow the phone', tokens: null },
  ]

  return (
    <div className="screen pad">
      <h1 style={{ margin: '8px 0 12px' }}>Settings</h1>

      <SectionTitle>ATTENDANCE TARGET</SectionTitle>
      <SliderField
        label="Minimum attendance to keep"
        value={s.threshold}
        min={1}
        max={100}
        emojiFor={thresholdEmoji}
        onChange={(n) => updateSettings({ threshold: n })}
        hint="Every warning and “can skip” number uses this."
      />

      <SliderField
        label="Assumed attendance for past unmarked classes"
        value={s.assumedPastAttendance}
        min={0}
        max={100}
        onChange={(n) => updateSettings({ assumedPastAttendance: n })}
        hint="Used until you mark a day or type real ERP totals."
      />

      <SectionTitle>THEME</SectionTitle>
      <div className="theme-tiles">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-tile ${choice === t.id ? 'on' : ''}`}
            onClick={() => setChoice(t.id)}
            aria-pressed={choice === t.id}
          >
            {t.tokens ? (
              <span
                className="theme-preview"
                style={{
                  background: THEME_TOKENS[t.tokens].bg,
                  borderTop: `8px solid ${THEME_TOKENS[t.tokens].headerTo}`,
                }}
              >
                <i style={{ background: THEME_TOKENS[t.tokens].card }} />
                <i style={{ background: THEME_TOKENS[t.tokens].primary }} />
                <i style={{ background: THEME_TOKENS[t.tokens].safe }} />
              </span>
            ) : (
              <span className="theme-preview auto">🌗</span>
            )}
            <b>{t.label}</b>
          </button>
        ))}
      </div>

      <SectionTitle>SEMESTER</SectionTitle>
      <div className="card">
        <label className="small-label">Semester name</label>
        <input
          value={s.semesterName}
          onChange={(e) => updateSettings({ semesterName: e.target.value })}
          placeholder="Semester 1"
        />
        <div className="field-row">
          <div className="grow">
            <label className="small-label">Start date</label>
            <input
              type="date"
              className="fill"
              value={semStart}
              onChange={(e) => {
                setSemStart(e.target.value)
                setSemSaved(false)
              }}
            />
          </div>
          <div className="grow">
            <label className="small-label">Tentative end</label>
            <input
              type="date"
              className="fill"
              value={semEnd}
              min={semStart || undefined}
              onChange={(e) => {
                setSemEnd(e.target.value)
                setSemSaved(false)
              }}
            />
          </div>
        </div>
        <button
          className="primary big-btn"
          style={{ width: '100%', marginTop: 10 }}
          disabled={!semValid || !semDirty}
          onClick={saveSemesterDates}
        >
          {semSaved ? '✓ Saved!' : semDirty ? 'Save semester dates' : 'Semester dates saved ✓'}
        </button>
        <div className="msg">
          Classes only appear inside this range; the monthly plan needs both. Saving re-dates your timetable to the
          start date so Today, Calendar and the Plan update immediately.
        </div>
      </div>

      {/* Batch rule (doc T8 + user requirement): div A has batches A1/A2/A3.
          The app shows only slots tagged with my batch or untagged (whole class). */}
      <SectionTitle>CLASS &amp; BATCH</SectionTitle>
      <div className="card">
        <label className="small-label">Division</label>
        {/* Division is a chip row so it can be changed with one tap (and
            re-tapped to deselect) — same pattern as the batch picker. */}
        <div className="batch-grid" role="radiogroup" aria-label="Division">
          {(['', 'A', 'B', 'C', 'D', 'E'] as const).map((d) => {
            const on = effDivision(s) === d
            return (
              <button
                key={d || 'none'}
                type="button"
                role="radio"
                aria-checked={on}
                className={`batch-opt ${on ? 'on' : ''}`}
                onClick={() => updateSettings({ myDivision: on ? '' : d })}
              >
                {d === '' ? 'Not set' : `Division ${d}`}
              </button>
            )
          })}
        </div>
        <label className="small-label" style={{ marginTop: 8 }}>Batch</label>
        <div className="batch-grid" role="radiogroup" aria-label="Batch">
          {(['', '1', '2', '3'] as const).map((b) => {
            const division = effDivision(s)
            const on = division !== '' && batchNumberOf(s.myBatch) === b
            return (
              <button
                key={b || 'all'}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={division === ''}
                className={`batch-opt ${on ? 'on' : ''}`}
                onClick={() => updateSettings({ myBatch: `${division}${b}` })}
              >
                {b === '' ? 'Whole division' : `Batch ${division}${b}`}
              </button>
            )
          })}
        </div>
        <div className="msg" style={{ marginTop: 8 }}>
          Your timetable is filtered by this: classes marked for other batches are hidden;
          classes with no batch tag (like a plain “A SDC (L)”) belong to everyone.
        </div>
      </div>

      <SectionTitle>REMINDERS</SectionTitle>
      <SliderField
        label="Remind me before a deadline by"
        value={s.reminderLeadDays}
        min={1}
        max={14}
        suffix=" days"
        onChange={(n) => updateSettings({ reminderLeadDays: n })}
        hint="Notifications arrive this many days early (Step 5 fires them)."
      />

      <div className="card">
        <label className="small-label">Notification arrival time</label>
        <input
          type="time"
          value={s.notificationTime}
          onChange={(e) => updateSettings({ notificationTime: e.target.value || '18:00' })}
        />
        <div className="msg">Time of day deadline reminder notifications arrive (F3).</div>
      </div>

      {/* F4: evening "mark your attendance" nudge (B11) */}
      <div className="card row spread">
        <div>
          <b>Evening mark reminder</b>
          <div className="msg">Nudges you if today’s classes aren’t all marked.</div>
        </div>
        <Toggle
          checked={s.eveningReminderOn}
          onChange={(v) => updateSettings({ eveningReminderOn: v })}
          label="Evening mark reminder"
        />
      </div>
      {s.eveningReminderOn && (
        <div className="field-row">
          <label className="small-label">At time</label>
          <input
            type="time"
            value={s.eveningReminderTime}
            onChange={(e) => updateSettings({ eveningReminderTime: e.target.value || '20:00' })}
          />
        </div>
      )}

      {/* F13 / F14 display toggles */}
      <div className="card row spread">
        <div>
          <b>Show room &amp; teacher</b>
          <div className="msg">On subject cards and class lists.</div>
        </div>
        <Toggle
          checked={s.showRoomTeacher}
          onChange={(v) => updateSettings({ showRoomTeacher: v })}
          label="Show room and teacher"
        />
      </div>
      <div className="card row spread">
        <div>
          <b>Quick actions</b>
          <div className="msg">Mark-all and add-deadline buttons on the day screen.</div>
        </div>
        <Toggle
          checked={s.showQuickActions}
          onChange={(v) => updateSettings({ showQuickActions: v })}
          label="Quick actions"
        />
      </div>

      <div className="card row spread">
        <div>
          <b>Sunday classes</b>
          <div className="msg">Sunday is off by default.</div>
        </div>
        <Toggle
          checked={s.sundayClasses}
          onChange={(v) => updateSettings({ sundayClasses: v })}
          label="Sunday classes"
        />
      </div>

      <SectionTitle>HOLIDAYS &amp; EXAM DAYS</SectionTitle>
      <div className="msg" style={{ marginBottom: 8 }}>
        Holidays hide that day’s classes; exam days are marked on the calendar but still count normally (A12).
      </div>
      {data.holidays.length === 0 && <div className="card msg">No holidays or exam days yet.</div>}
      {data.holidays.map((h) => (
        <div className="card row spread" key={h.id}>
          <div>
            <b>{h.isExamDay ? '📝' : '🎉'} {h.label}</b>
            <div className="msg">
              {formatShort(h.startDate)}
              {h.endDate !== h.startDate ? ` → ${formatShort(h.endDate)}` : ''} ·{' '}
              {h.isExamDay ? 'exam day' : 'holiday'}
            </div>
          </div>
          <button onClick={() => deleteHoliday(h.id)}>Remove</button>
        </div>
      ))}
      <div className="card">
        <label>Label</label>
        <input value={holLabel} onChange={(e) => setHolLabel(e.target.value)} placeholder="Diwali break / Mid-terms" />
        <div className="field-row">
          <div className="grow">
            <label className="small-label">From</label>
            <input type="date" value={holStart} onChange={(e) => setHolStart(e.target.value)} />
          </div>
          <div className="grow">
            <label className="small-label">To</label>
            <input type="date" value={holEnd || holStart} onChange={(e) => setHolEnd(e.target.value)} />
          </div>
        </div>
        <div className="card row spread" style={{ marginTop: 6 }}>
          <div>
            <b>Exam day</b>
            <div className="msg">Off by mistake? No — exam days keep counting for attendance.</div>
          </div>
          <Toggle checked={holIsExam} onChange={setHolIsExam} label="Exam day" />
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="primary"
            disabled={!holLabel.trim() || !holStart}
            onClick={() => {
              const start = holStart
              const end = holEnd && holEnd >= holStart ? holEnd : holStart
              addHoliday({ label: holLabel.trim(), startDate: start, endDate: end, isExamDay: holIsExam })
              setHolLabel('')
              setHolStart('')
              setHolEnd('')
              setHolIsExam(false)
            }}
          >
            Add {holIsExam ? 'exam day' : 'holiday'}
          </button>
        </div>
      </div>

      <SectionTitle>PASTE A DEADLINE MESSAGE</SectionTitle>
      <DeadlinePaste />

      <SectionTitle>COLLEGE EMAIL</SectionTitle>
      <GmailSetup />
      <EmailInbox />

      <SectionTitle>REAL TOTALS FROM THE COLLEGE ERP</SectionTitle>
      <div className="msg" style={{ marginBottom: 8 }}>
        Typing totals replaces the app’s calculated figures for that subject.
      </div>
      {data.subjects.length === 0 && <div className="card msg">No subjects yet.</div>}
      {data.subjects.map((sub) => (
        <ErpRow key={sub.id} id={sub.id} short={sub.shortName} attended={sub.typedAttended} held={sub.typedHeld} />
      ))}

      <SectionTitle>SEMESTER ARCHIVE</SectionTitle>
      <ArchiveSection />

      <SectionTitle>YOUR DATA</SectionTitle>
      <div className="card row">
        <button className="secondary big-btn grow" onClick={() => exportData(data)}>
          Export my data
        </button>
        {confirmDelete ? (
          <button
            className="danger big-btn grow"
            onClick={() => {
              resetAll()
              setConfirmDelete(false)
            }}
          >
            Tap again to confirm
          </button>
        ) : (
          <button className="danger-quiet big-btn grow" onClick={() => setConfirmDelete(true)}>
            Delete all my data
          </button>
        )}
      </div>
    </div>
  )
}

// Stretch #4: multi-semester archive. End a semester → snapshot stays here
// read-only (totals + per-subject attendance); start fresh next semester.
// Restoring an archived semester swaps it back in (the current one is
// auto-archived first, so nothing is ever lost).
function ArchiveSection() {
  const { data, archiveSemester, archivedSemesters, deleteArchived, restoreArchive } = useApp()
  const [archives, setArchives] = useState(() => archivedSemesters())
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const hasLive = data.subjects.length > 0 || data.slots.length > 0

  const refresh = () => setArchives(archivedSemesters())

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="msg" style={{ margin: 0 }}>
        Semester finished? Archive it — the totals are kept and you start the new semester clean. You can restore any
        archived semester later to view or continue it.
      </div>
      {done && <div className="msg" style={{ margin: 0, color: 'var(--ok, #2e7d32)' }}>{done}</div>}
      <button
        className="secondary big-btn grow"
        disabled={!hasLive}
        onClick={() => {
          const entry = archiveSemester()
          setDone(entry ? `Archived “${entry.label}”. Start the new timetable when ready.` : 'Nothing to archive yet.')
          refresh()
        }}
      >
        {hasLive
          ? `Archive “${data.settings.semesterName || 'current semester'}” & start fresh`
          : 'No active semester to archive'}
      </button>

      {archives.length === 0 ? (
        <div className="msg" style={{ margin: 0 }}>
          No archived semesters yet.
        </div>
      ) : (
        archives.map((a) => (
          <div key={a.id} className="card" style={{ background: 'var(--bg, rgba(0,0,0,0.03))' }}>
            <b>{a.label}</b>
            <div className="msg" style={{ margin: '2px 0' }}>
              {a.startDate ?? '?'} → {a.endDate ?? 'archived'} · saved {a.archivedOn}
            </div>
            <div className="msg" style={{ margin: '2px 0' }}>
              {a.summary.join(' · ') || 'No subjects recorded.'}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 8 }}>
              {confirmId === a.id ? (
                <button
                  className="danger big-btn grow"
                  onClick={() => {
                    if (restoreArchive(a.id)) setDone(`Restored “${a.label}”. The previous data was archived for you.`)
                    setConfirmId(null)
                    refresh()
                  }}
                >
                  Tap again to confirm restore
                </button>
              ) : (
                <button className="secondary big-btn grow" onClick={() => setConfirmId(a.id)}>
                  Restore
                </button>
              )}
              <button
                className="danger-quiet big-btn grow"
                onClick={() => {
                  deleteArchived(a.id)
                  refresh()
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// I1/I2: one-time Google Cloud OAuth setup. The user creates an "OAuth client
// ID (Web application)" in their own Google Cloud project, enables the Gmail
// API, and pastes the client ID here — no secrets bundled in the app.
export function GmailSetup() {
  const [clientId, setClientId] = useState(loadGmailConfig()?.clientId ?? '')
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="msg" style={{ margin: 0 }}>
        To let the app read your college emails automatically: create a project at console.cloud.google.com → enable
        the Gmail API → OAuth consent screen (External) → Credentials → “OAuth client ID” of type Web application →
        add this app’s URL as an Authorized redirect URI → paste the Client ID below. Nothing leaves your phone except
        the standard Google sign-in; the app only ever reads mail titles/bodies (gmail.readonly).
      </div>
      <label className="small-label">Google Cloud Client ID</label>
      <input
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value)
          setSaved(null)
        }}
        placeholder="1234567890-xxxx.apps.googleusercontent.com"
        spellCheck={false}
      />
      <div className="msg" style={{ margin: 0 }}>
        Redirect URI to authorize: <code>{defaultRedirectUri()}</code>
      </div>
      <div>
        <button
          className="btn small"
          disabled={!clientId.trim().endsWith('.apps.googleusercontent.com')}
          onClick={() => {
            saveGmailConfig(clientId)
            setSaved('Saved. You can now connect Gmail above.')
          }}
        >
          Save Client ID
        </button>
        {saved && <span className="msg" style={{ marginLeft: 8 }}>{saved}</span>}
      </div>
    </div>
  )
}

function ErpRow({ id, short, attended, held }: { id: string; short: string; attended?: number; held?: number }) {
  const { setData } = useApp()

  function set(a: string, h: string) {
    setData((d) => ({
      ...d,
      subjects: d.subjects.map((sub) => {
        if (sub.id !== id) return sub
        const next = { ...sub }
        if (h.trim() === '') {
          delete next.typedHeld
          delete next.typedAttended
        } else {
          next.typedHeld = Math.max(0, Number(h) || 0)
          next.typedAttended = Math.max(0, Number(a) || 0)
        }
        return next
      }),
    }))
  }

  return (
    <div className="card">
      <b>{short}</b>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <div className="grow">
          <label className="small-label">Attended</label>
          <input type="number" min={0} value={attended ?? ''} onChange={(e) => set(e.target.value, String(held ?? ''))} />
        </div>
        <div className="grow">
          <label className="small-label">Held</label>
          <input type="number" min={0} value={held ?? ''} onChange={(e) => set(String(attended ?? ''), e.target.value)} />
        </div>
        {(held !== undefined || attended !== undefined) && (
          <button className="chip" onClick={() => set('', '')}>Clear</button>
        )}
      </div>
    </div>
  )
}
