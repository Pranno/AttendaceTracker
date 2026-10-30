// ============================================================
// E1 — Courses screen parts: subject course cards and the opened-
// subject view (Units / Marks / Due chips). Used by the Study tab.
// ============================================================

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../data/store'
import { todayStr } from '../logic/dates'
import type { Subject } from '../data/model'
import { buildReport } from '../logic/attendance'
import { describeDeadline, gradeFromPercent, subjectMarks, upcomingDeadlines } from '../logic/study'
import { StatusPill } from './ui/parts'
import MarksPanel from './MarksPanel'


/** E1: one card per subject — credits, units revised out of total, topics
 *  revised (E3), marks so far %, next undone deadline and a progress bar of
 *  units revised. Tapping the card opens it (Units / Marks / Due chips). */
export function CourseCard({ subject, onOpen }: { subject: Subject; onOpen: () => void }) {
  const { data } = useApp()
  const today = todayStr()

  const units = useMemo(() => data.units.filter((u) => u.subjectId === subject.id), [data.units, subject.id])
  const revisedUnits = units.filter((u) => u.revisedDate).length
  const topicsTotal = units.reduce((n, u) => n + u.topics.length, 0)
  const topicsRevised = units.reduce((n, u) => n + u.topics.filter((t) => t.revisedDate).length, 0)

  const marksPct = useMemo(() => {
    const byComp: Record<string, { got: number; out: number }[]> = {}
    for (const sc of data.scores.filter((x) => x.subjectId === subject.id && x.componentId)) {
      ;(byComp[sc.componentId!] ??= []).push({ got: sc.marksGot, out: sc.outOf })
    }
    if (!Object.keys(byComp).length) return null
    const rangeStart = data.settings.semesterStart ?? today
    const rep = buildReport(data, today, rangeStart, today)
    const s = rep.bySubject.find((x) => x.subjectId === subject.id)
    const m = subjectMarks(subject, byComp, s?.held ?? 0, s?.attended ?? 0)
    return m.showable && m.percent !== null ? m.percent : null
  }, [data, subject, today])

  const nextDue = useMemo(() => {
    const list = upcomingDeadlines(data, 3, today).filter((d) => d.subjectId === subject.id)
    return list[0] ?? null
  }, [data, subject.id, today])

  const pctBar = units.length > 0 ? (revisedUnits / units.length) * 100 : 0

  return (
    <button className="card course-card" onClick={onOpen} style={{ textAlign: 'left', width: '100%' }}>
      <div className="row spread">
        <b>{subject.shortName} · {subject.fullName}</b>
        {typeof subject.credits === 'number' && subject.credits > 0 && <StatusPill tone="neutral">{subject.credits} cr</StatusPill>}
      </div>
      <div className="class-meta">
        {units.length > 0
          ? `${revisedUnits} of ${units.length} unit${units.length === 1 ? '' : 's'} revised`
          : 'No units yet — add them below or import the syllabus'}
        {topicsTotal > 0 ? `, topics revised: ${topicsRevised} of ${topicsTotal}` : ''}
        {marksPct !== null ? `, ${Math.round(marksPct)}% of marks so far (≈ ${gradeFromPercent(marksPct)})` : ''}
      </div>
      {nextDue && (
        <div className="msg" style={{ marginTop: 4 }}>Next: {describeDeadline(nextDue, today)}</div>
      )}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pctBar}%` }} />
      </div>
    </button>
  )
}

/** E1 opened-subject view: chips Units / Marks / Due (with count).
 *  A subject with no syllabus yet shows only its deadlines and a prompt to
 *  add units. `unitsSlot` is the existing UnitCard editor rendered by Study. */
export function SubjectCourseView({
  subject,
  onBack,
  unitsSlot,
}: {
  subject: Subject
  onBack: () => void
  unitsSlot: ReactNode
}) {
  const { data, removeSubject: deleteSubject } = useApp()
  const today = todayStr()
  const units = useMemo(() => data.units.filter((u) => u.subjectId === subject.id), [data.units, subject.id])
  const due = useMemo(
    () => data.deadlines.filter((d) => d.subjectId === subject.id && !d.done),
    [data.deadlines, subject.id],
  )
  const [part, setPart] = useState<'units' | 'marks' | 'due'>('units')

  return (
    <div className="screen pad">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ margin: 0 }}>{subject.shortName}</h1>
        <span className="grow" />
        <button className="icon-btn" aria-label={`Archive semester data for ${subject.shortName}`} onClick={() => { if (window.confirm(`Remove ${subject.shortName} and its units, marks and deadlines?`)) deleteSubject(subject.id) }}>🗑</button>
      </div>
      <div className="msg" style={{ marginBottom: 8 }}>{subject.fullName}{typeof subject.credits === 'number' && subject.credits > 0 ? ` · ${subject.credits} credits` : ''}</div>

      {/* part chips (E1) */}
      <div className="chip-row" role="tablist" style={{ marginBottom: 10 }}>
        <button className={part === 'units' ? 'chip chip-on' : 'chip'} onClick={() => setPart('units')}>
          Units{units.length ? ` (${units.length})` : ''}
        </button>
        <button className={part === 'marks' ? 'chip chip-on' : 'chip'} onClick={() => setPart('marks')}>Marks</button>
        <button className={part === 'due' ? 'chip chip-on' : 'chip'} onClick={() => setPart('due')}>Due{due.length ? ` (${due.length})` : ''}</button>
      </div>

      {part === 'units' && (
        units.length === 0 && due.length === 0 ? (
          <div className="card msg">No units yet for this subject. Add units below, or upload the syllabus so every unit lists all its topics.</div>
        ) : (
          unitsSlot
        )
      )}
      {part === 'marks' && <MarksPanel subject={subject} />}
      {part === 'due' && (
        <div>
          {due.length === 0 && <div className="card msg">Nothing due for this subject.</div>}
          {due.map((d) => (
            <div className="card row spread" key={d.id}>
              <div>
                <b>{d.title}</b>
                <div className="msg">{describeDeadline(d, today)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
