// Subjects screen (Step 2): one compact row per subject showing the key
// numbers at a glance (name + division letter, lectures this month, overall
// attendance %, lectures remaining, can-skip). Tapping a row expands it
// in-place to reveal the full details: monthly plan card, attended/held
// summary, threshold override and the weekly schedule for that subject.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useApp } from '../data/store'
import type { DateStr } from '../data/model'
import { buildReport, computeSubjectTotals, freshData, summarizeSubject } from '../logic/attendance'
import { projectSubjectMonth } from '../logic/projection'
import { todayStr, weekdayName, monthKey } from '../logic/dates'
import { SectionTitle, StatusPill } from './ui/parts'
import { subjectPalette, subjectTileStyle, STATUS_VAR } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import type { Tab } from './NavBar'
import MonthlyPlanCard from './MonthlyPlanCard'

export default function Subjects({ go, focusSubjectId }: { go: (t: Tab, subjectId?: string) => void; focusSubjectId?: string | null }) {
  const { data } = useApp()
  const [openId, setOpenId] = useState<string | null>(null)

  // Deep-link from Today/warnings: open the focused subject's page directly.
  useEffect(() => {
    if (focusSubjectId) setOpenId(focusSubjectId)
  }, [focusSubjectId])

  const today = todayStr()
  const rangeStart = useMemo<DateStr>(() => {
    if (data.settings.semesterStart) return data.settings.semesterStart
    if (data.slots.length === 0) return today
    return data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today)
  }, [data.settings.semesterStart, data.slots, today])

  const report = useMemo(
    () => buildReport(freshData(data), today, rangeStart, today),
    [data, today, rangeStart],
  )

  return (
    <div className="screen pad">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Subjects</h1>
      </div>

      {report.bySubject.length === 0 ? (
        <div className="card empty-card">🗒️ No subjects yet — add your timetable under “Timetable”.</div>
      ) : (
        <div className="subj-rows">
          {report.bySubject.map((s, i) => {
            const pal = subjectPalette(i)
            // One quick projection per subject for the "this month / remaining"
            // numbers on the summary row.
            const plan = projectSubjectMonth(data, s.subjectId, monthKey(today), today, { ignorePast: data.settings.ignorePastAttendance })
            const expanded = openId === s.subjectId
            return (
              <div className="subj-row-wrap" key={s.subjectId}>
                <button
                  type="button"
                  className="subj-row card-like"
                  aria-expanded={expanded}
                  onClick={() => setOpenId(expanded ? null : s.subjectId)}
                >
                  <span className="subj-letter" style={{ background: pal.strong }}>{s.shortName.slice(0, 1)}</span>
                  <span className="subj-main">
                    <span className="subj-top">
                      <b className="subj-name">{s.shortName}</b>
                      <span className="subj-meta">this month · {plan.classesInMonth} lec</span>
                    </span>
                    <span className="subj-bottom">
                      <span className={`badge ${s.status}`} style={{ color: STATUS_VAR[s.status] }}>
                        attendance {s.held === 0 ? '—' : `${Math.round(s.percent)}%`}
                      </span>
                      <span className="subj-meta">remaining · {plan.classesLeft} lec</span>
                      <span className="subj-meta subj-skip" style={{ color: STATUS_VAR[s.status] }}>
                        can skip · {plan.canSkip}
                      </span>
                    </span>
                  </span>
                  <ChevronDown size={18} className={`subj-chevron ${expanded ? 'open' : ''}`} />
                </button>
                {expanded && <SubjectDetail subjectId={s.subjectId} go={go} onClose={() => setOpenId(null)} />}
              </div>
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

/** In-place expanded detail for one subject row: monthly plan card (J8),
 *  attended/held summary with the friendly verdict line, per-subject target
 *  override and the weekly schedule. */
function SubjectDetail({ subjectId, go, onClose }: { subjectId: string; go: (t: Tab, subjectId?: string) => void; onClose: () => void }) {
  const { data } = useApp()
  const { active } = useTheme()
  const today = todayStr()

  const subjIdx = Math.max(0, data.subjects.findIndex((s) => s.id === subjectId))
  const rangeStart = useMemo<DateStr>(() => {
    if (data.settings.semesterStart) return data.settings.semesterStart
    if (data.slots.length === 0) return today
    return data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today)
  }, [data.settings.semesterStart, data.slots, today])

  const totals = useMemo(
    () => computeSubjectTotals(freshData(data), subjectId, rangeStart, today, today),
    [data, subjectId, rangeStart, today],
  )
  const summary = useMemo(() => summarizeSubject(data, subjectId, totals), [data, subjectId, totals])

  const slots = data.slots
    .filter((sl) => sl.subjectId === subjectId && (!sl.validUntil || sl.validUntil >= today))
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))

  return (
    <div className="subj-detail">
      {/* J8: Monthly Plan card at the top of each subject's details */}
      <MonthlyPlanCard subjectId={subjectId} onOpenSettings={() => go('settings')} />

      <div className="card" style={subjectTileStyle(subjIdx, active)}>
        <b>{summary.name}</b>
        <div className="class-meta">{summary.attended}/{summary.held} classes attended · target {summary.threshold}%</div>
        <div style={{ marginTop: 6 }}><b>{summary.message}</b></div>
      </div>

      {/* F2 (Stretch): per-subject threshold override. */}
      <ThresholdEditor subjectId={subjectId} />

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

      <button type="button" className="btn ghost subj-collapse" onClick={onClose}>Collapse ▲</button>
    </div>
  )
}

/** F2 (Stretch): per-subject attendance threshold. By default a subject uses
 *  the global threshold from Settings; turning this on gives it its own value
 *  (e.g. labs at 90%). The change flows into every calculation automatically
 *  (attendance.ts, projection.ts both read effectiveThreshold). */
function ThresholdEditor({ subjectId }: { subjectId: string }) {
  const { data, updateSubject } = useApp()
  const subject = data.subjects.find((s) => s.id === subjectId)
  if (!subject) return null
  const hasOverride = typeof subject.thresholdOverride === 'number'
  const value = subject.thresholdOverride ?? data.settings.threshold

  return (
    <div className="card row spread" style={{ alignItems: 'center' }}>
      <span>
        <b>Separate target %</b>
        <div className="class-meta">
          {hasOverride
            ? `This subject uses ${value}% instead of the global ${data.settings.threshold}%`
            : `Uses the global target (${data.settings.threshold}%)`}
        </div>
      </span>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={hasOverride}
          onChange={(e) => updateSubject(subjectId, { thresholdOverride: e.target.checked ? Math.min(100, Math.max(0, value)) : undefined })}
        />
      </label>
      {hasOverride && (
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isNaN(n)) updateSubject(subjectId, { thresholdOverride: Math.min(100, Math.max(0, n)) })
          }}
          style={{ width: 70 }}
        />
      )}
    </div>
  )
}
