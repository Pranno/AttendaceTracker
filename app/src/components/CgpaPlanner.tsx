// ============================================================
// E11 — CGPA planner (Study tab section).
//  • Add / delete semesters, entered either "By subject" (optional name,
//    credits, grade) or "I know my SGPA" (SGPA + credits).
//  • Grade points O=10 … F=0; SGPA = Σ(credits×points) ÷ Σcredits;
//    CGPA = Σ(SGPA×credits) ÷ Σcredits — shown large with
//    "Across N semesters and C credits".
//  • Subjects with no grade yet are estimated from marks so far (E5) via
//    the grade guide: "on track for an SGPA of about X…".
//  • Planner: target CGPA + next-semester credits → needed SGPA (rounded
//    up to 2 dp), with the not-reachable / already-safe messages.
// All maths lives in logic/study.ts; this file is UI only.
// ============================================================

import { useMemo, useState } from 'react'
import { useApp } from '../data/store'
import type { CgpaSemester } from '../data/model'
import { buildReport } from '../logic/attendance'
import { todayStr } from '../logic/dates'
import {
  GRADE_POINTS,
  cgpaOf,
  estimateSgpaFromMarks,
  gradeFromPercent,
  neededSgpa,
  sgpaOf,
  subjectMarks,
} from '../logic/study'
import { SectionTitle } from './ui/parts'

const GRADES = Object.keys(GRADE_POINTS) // O, A+, A, B+, B, C, P, F

export default function CgpaPlanner() {
  const { data, addSemester, updateSemester, deleteSemester } = useApp()
  const semesters = data.cgpaSemesters ?? []

  const overall = useMemo(() => cgpaOf(semesters), [semesters])

  // E5 marks-so-far per subject, for estimating grades of ungraded subjects.
  const marksBySubject = useMemo(() => {
    const today = todayStr()
    const rangeStart = data.settings.semesterStart ?? today
    const rep = buildReport(data, today, rangeStart, today)
    const map: Record<string, number | null> = {}
    for (const subj of data.subjects) {
      const byComp: Record<string, { got: number; out: number }[]> = {}
      for (const sc of data.scores.filter((x) => x.subjectId === subj.id && x.componentId)) {
        ;(byComp[sc.componentId!] ??= []).push({ got: sc.marksGot, out: sc.outOf })
      }
      const s = rep.bySubject.find((x) => x.subjectId === subj.id)
      const m = subjectMarks(subj, byComp, s?.held ?? 0, s?.attended ?? 0)
      map[subj.id] = m.showable && m.percent !== null ? m.percent : null
    }
    return map
  }, [data])

  // Current semester (the active one): estimate its SGPA from marks so far.
  const currentEstimate = useMemo(() => {
    if (data.subjects.length === 0) return null
    const entries = data.subjects.map((s) => ({
      credits: s.credits ?? 0,
      percent: marksBySubject[s.id] ?? null,
    }))
    const est = estimateSgpaFromMarks(entries)
    if (est === null) return null
    const graded = semesters.some((sm) => sgpaOf(sm) !== null)
    return { est, merged: graded ? cgpaOf([...semesters, { id: 'cur', label: '', mode: 'subjects' as const, subjects: data.subjects.map((s) => ({ credits: s.credits ?? 0, grade: gradeFromPercent(marksBySubject[s.id] ?? 0) })) }]) : null }
  }, [data.subjects, marksBySubject, semesters])

  const [target, setTarget] = useState('')
  const [nextCredits, setNextCredits] = useState('')
  const plan = useMemo(() => {
    const t = Number(target)
    const c = Number(nextCredits)
    if (!Number.isFinite(t) || !target.trim()) return null
    return neededSgpa(semesters, t, c)
  }, [semesters, target, nextCredits])

  return (
    <div>
      <SectionTitle>CGPA PLANNER</SectionTitle>

      {/* Big CGPA number */}
      <div className="card">
        {overall ? (
          <>
            <div className="num big" style={{ fontSize: 34 }}>{overall.cgpa.toFixed(2)}</div>
            <div className="msg">Across {overall.sems} semester{overall.sems === 1 ? '' : 's'} and {overall.credits} credits</div>
          </>
        ) : (
          <div className="msg">Add completed semesters below to see your CGPA.</div>
        )}
        {currentEstimate && (
          <div className="msg" style={{ marginTop: 6 }}>
            On track for an SGPA of about {currentEstimate.est.toFixed(2)} this semester.{' '}
            {currentEstimate.merged ? `That would take your CGPA to about ${currentEstimate.merged.cgpa.toFixed(2)}. ` : ''}
            A rough guide until results are out.
          </div>
        )}
      </div>

      {/* Semester list */}
      {semesters.map((sm) => (
        <SemesterCard key={sm.id} sem={sm} onChange={(p) => updateSemester(sm.id, p)} onDelete={() => deleteSemester(sm.id)} />
      ))}
      <button style={{ marginTop: 8 }} onClick={() => addSemester()}>+ Add semester</button>

      {/* Planner */}
      <div className="card" style={{ marginTop: 10 }}>
        <b>Target planner</b>
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <label className="msg">Target CGPA
            <input style={{ width: 80, marginLeft: 6 }} type="number" step="0.01" min={0} max={10} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="msg">Next sem credits
            <input style={{ width: 70, marginLeft: 6 }} type="number" min={1} value={nextCredits} onChange={(e) => setNextCredits(e.target.value)} />
          </label>
        </div>
        {plan && <div className="msg" style={{ marginTop: 8 }}>{plan.message}</div>}
      </div>
    </div>
  )
}

// ---------------- one semester row ----------------
function SemesterCard({
  sem,
  onChange,
  onDelete,
}: {
  sem: CgpaSemester
  onChange: (p: Partial<CgpaSemester>) => void
  onDelete: () => void
}) {
  const res = sgpaOf(sem)
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row spread">
        <input
          className="grow"
          style={{ fontWeight: 700 }}
          value={sem.label}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Semester label"
        />
        <span className="row" style={{ gap: 6 }}>
          {res && <b className="num">{res.sgpa.toFixed(2)}</b>}
          <button className="icon-btn" aria-label={`Delete ${sem.label}`} onClick={onDelete}>🗑</button>
        </span>
      </div>

      {/* mode switch */}
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className={sem.mode === 'subjects' ? 'secondary' : ''} onClick={() => onChange({ mode: 'subjects' })}>By subject</button>
        <button className={sem.mode === 'sgpa' ? 'secondary' : ''} onClick={() => onChange({ mode: 'sgpa' })}>I know my SGPA</button>
      </div>

      {sem.mode === 'sgpa' ? (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <label className="msg">SGPA
            <input
              style={{ width: 80, marginLeft: 6 }} type="number" step="0.01" min={0} max={10}
              value={sem.sgpa ?? ''}
              onChange={(e) => onChange({ sgpa: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className="msg">Credits
            <input
              style={{ width: 70, marginLeft: 6 }} type="number" min={1}
              value={sem.credits ?? ''}
              onChange={(e) => onChange({ credits: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
        </div>
      ) : (
        <SubjectsEditor sem={sem} onChange={onChange} />
      )}

      {!res && sem.mode === 'subjects' && (sem.subjects?.length ?? 0) > 0 && (
        <div className="msg" style={{ marginTop: 4 }}>Enter credits and a grade for at least one subject.</div>
      )}
    </div>
  )
}

function SubjectsEditor({ sem, onChange }: { sem: CgpaSemester; onChange: (p: Partial<CgpaSemester>) => void }) {
  const rows = sem.subjects ?? []
  const setRows = (list: NonNullable<CgpaSemester['subjects']>) => onChange({ subjects: list })

  return (
    <div style={{ marginTop: 8 }}>
      {rows.map((r, i) => (
        <div className="row" key={i} style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <input
            className="grow" placeholder="Subject (optional)" value={r.name ?? ''}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            style={{ width: 64 }} type="number" min={0} placeholder="Cr" value={r.credits || ''}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, credits: Number(e.target.value) } : x)))}
          />
          <select
            value={r.grade}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))}
          >
            <option value="">Grade…</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>{g} ({GRADE_POINTS[g]})</option>
            ))}
          </select>
          <button className="icon-btn" aria-label="Remove subject" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button onClick={() => setRows([...rows, { credits: 0, grade: '' }])}>+ Subject</button>
    </div>
  )
}
