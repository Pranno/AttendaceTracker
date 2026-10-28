// Subjects screen (Step 2): a grid of big round icon tiles (Uber-services
// style), each with the subject colour, name and an attendance badge in the
// safe/limit/danger tone. Opening a subject shows its percentage card, can-miss
// line and the weekly timetable for that subject. The Timetable editor from
// Step 1 lives under the "Timetable" chip here (full upload flow arrives Step 3).

import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../data/store'
import type { DateStr } from '../data/model'
import { buildReport } from '../logic/attendance'
import { todayStr, weekdayName } from '../logic/dates'
import { SectionTitle, StatusPill, ChipRow } from './ui/parts'
import { subjectPalette, subjectTileStyle, STATUS_VAR } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import type { Tab } from './NavBar'
import Timetable from './Timetable'

const SUBJECT_ICONS = ['📘', '🧪', '🧮', '💻', '📡', '🎨', '🛠️', '🌐']

export default function Subjects({ go }: { go: (t: Tab, subjectId?: string) => void }) {
  const { data } = useApp()
  const { active } = useTheme()
  const [view, setView] = useState<'grid' | 'timetable'>('grid')
  const [openId, setOpenId] = useState<string | null>(null)

  const today = todayStr()
  const rangeStart = useMemo<DateStr>(() => {
    if (data.settings.semesterStart) return data.settings.semesterStart
    if (data.slots.length === 0) return today
    return data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today)
  }, [data.settings.semesterStart, data.slots, today])

  const report = useMemo(
    () => buildReport(data, today, rangeStart, today),
    [data, today, rangeStart],
  )

  const open = openId ? report.bySubject.find((s) => s.subjectId === openId) : null
  const openIdx = open ? data.subjects.findIndex((s) => s.id === open.subjectId) : 0

  if (view === 'timetable') {
    return (
      <div className="screen pad">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => setView('grid')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0 }}>Timetable</h1>
        </div>
        <Timetable />
      </div>
    )
  }

  if (open) {
    const slots = data.slots
      .filter((sl) => sl.subjectId === open.subjectId && (!sl.validUntil || sl.validUntil >= today))
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    return (
      <div className="screen pad">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => setOpenId(null)} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0 }}>{open.shortName}</h1>
          <span className="grow" />
          <StatusPill tone={open.status === 'safe' ? 'safe' : open.status === 'limit' ? 'limit' : open.status === 'below' ? 'below' : 'neutral'}>
            {open.held === 0 ? 'no data' : `${open.percent.toFixed(1)}%`}
          </StatusPill>
        </div>
        <div className="card" style={subjectTileStyle(openIdx, active)}>
          <b>{open.name}</b>
          <div className="class-meta">{open.attended}/{open.held} classes attended · target {open.threshold}%</div>
          <div style={{ marginTop: 6 }}><b>{open.message}</b></div>
        </div>
        <SectionTitle>EVERY WEEK</SectionTitle>
        {slots.length === 0 && <div className="card msg">No lectures scheduled.</div>}
        {slots.map((sl) => (
          <div className="card row spread" key={sl.id}>
            <span>
              <b>{weekdayName(sl.weekday)}</b>{' '}
              <span className="msg">
                {sl.startTime}–{sl.endTime} · {sl.type}
                {sl.room ? ` · ${sl.room}` : ''}
              </span>
            </span>
            <StatusPill tone="neutral">{sl.teacher || '—'}</StatusPill>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="screen pad">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Subjects</h1>
      </div>
      <ChipRow
        options={[
          { id: 'grid', label: 'My subjects' },
          { id: 'timetable', label: 'Timetable' },
        ]}
        value={view}
        onChange={setView}
      />

      {report.bySubject.length === 0 ? (
        <div className="card empty-card">🗒️ No subjects yet — add your timetable under “Timetable”.</div>
      ) : (
        <div className="subj-grid">
          {report.bySubject.map((s, i) => {
            const pal = subjectPalette(i)
            const tile = subjectTileStyle(i, active)
            return (
              <button key={s.subjectId} className="subj-tile card-like" style={tile} onClick={() => setOpenId(s.subjectId)}>
                <span className="subj-round" style={{ background: pal.strong }}>
                  {SUBJECT_ICONS[i % SUBJECT_ICONS.length]}
                </span>
                <b>{s.shortName}</b>
                <span className={`badge ${s.status}`} style={{ color: STATUS_VAR[s.status] }}>
                  {s.held === 0 ? '—' : `${Math.round(s.percent)}%`}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {report.warnings.length > 0 && (
        <>
          <SectionTitle>NEEDS ATTENTION</SectionTitle>
          {report.warnings.map((w) => (
            <button className="card subject-card subject-card-link" key={w.subjectId} style={{ borderLeft: '6px solid var(--danger)' }} onClick={() => go('plan', w.subjectId)}>
              <b>{w.shortName}</b> <span className="msg">{w.message}</span>
              <span className="msg"> · see plan →</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
