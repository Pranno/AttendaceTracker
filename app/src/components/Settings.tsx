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

export default function Settings() {
  const { data, updateSettings, resetAll } = useApp()
  const { choice, setChoice } = useTheme()
  const s = data.settings
  const [confirmDelete, setConfirmDelete] = useState(false)

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
              value={s.semesterStart ?? ''}
              onChange={(e) => updateSettings({ semesterStart: e.target.value || null })}
            />
          </div>
          <div className="grow">
            <label className="small-label">Tentative end</label>
            <input
              type="date"
              className="fill"
              value={s.semesterEnd ?? ''}
              min={s.semesterStart ?? undefined}
              onChange={(e) => updateSettings({ semesterEnd: e.target.value || null })}
            />
          </div>
        </div>
        <div className="msg">Classes only appear inside this range; the monthly plan needs both.</div>
      </div>

      {/* Batch rule (doc T8 + user requirement): div A has batches A1/A2/A3.
          The app shows only slots tagged with my batch or untagged (whole class). */}
      <SectionTitle>CLASS &amp; BATCH</SectionTitle>
      <div className="card">
        <label className="small-label">Division</label>
        <select
          className="fill"
          value={divisionOf(s.myBatch)}
          onChange={(e) => updateSettings({ myBatch: joinBatch(e.target.value, batchNumberOf(s.myBatch)) })}
        >
          <option value="">Not set</option>
          {['A', 'B', 'C', 'D', 'E'].map((d) => (
            <option key={d} value={d}>Division {d}</option>
          ))}
        </select>
        <label className="small-label" style={{ marginTop: 8 }}>Batch</label>
        <div className="batch-grid" role="radiogroup" aria-label="Batch">
          {(['', '1', '2', '3'] as const).map((b) => {
            const division = divisionOf(s.myBatch)
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

      <SectionTitle>REAL TOTALS FROM THE COLLEGE ERP</SectionTitle>
      <div className="msg" style={{ marginBottom: 8 }}>
        Typing totals replaces the app’s calculated figures for that subject.
      </div>
      {data.subjects.length === 0 && <div className="card msg">No subjects yet.</div>}
      {data.subjects.map((sub) => (
        <ErpRow key={sub.id} id={sub.id} short={sub.shortName} attended={sub.typedAttended} held={sub.typedHeld} />
      ))}

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
