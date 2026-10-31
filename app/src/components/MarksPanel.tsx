// ============================================================
// E5 — Marks panel for one subject.
//  • Marking scheme built by hand: components with label, weight,
//    "out of", expected entries and optional "best N count".
//  • Scores per component shown as small chips, each deletable with ×.
//  • Component result = fraction (sum got ÷ sum out, best-N aware);
//    contributes weight × fraction.
//  • The attendance component is automatic (attended ÷ held) and cannot
//    be edited by hand.
//  • Subject marks so far = Σ contributions ÷ Σ weights of counted
//    components — shown as % and "about X of Y marks", only once at
//    least one non-attendance score exists. Grade band labelled
//    "a rough guide".
// All maths lives in logic/study.ts (subjectMarks); this file is UI only.
// ============================================================

import { useMemo, useState } from 'react'
import { useApp } from '../data/store'
import type { MarkingComponent, Subject } from '../data/model'
import { newId } from '../data/model'
import { buildReport, freshData } from '../logic/attendance'
import { todayStr } from '../logic/dates'
import { gradeFromPercent, subjectMarks } from '../logic/study'
import { StatusPill } from './ui/parts'

export default function MarksPanel({ subject }: { subject: Subject }) {
  const { data, updateSubject, addScore, removeScore } = useApp()
  const today = todayStr()

  // Attendance totals for the automatic component (B-series numbers).
  const att = useMemo(() => {
    const rangeStart = data.settings.semesterStart ?? today
    const rep = buildReport(freshData(data), today, rangeStart, today)
    const s = rep.bySubject.find((x) => x.subjectId === subject.id)
    return { held: s?.held ?? 0, attended: s?.attended ?? 0 }
  }, [data, subject.id, today])

  const scoresByComponent = useMemo(() => {
    const map: Record<string, { got: number; out: number }[]> = {}
    for (const sc of data.scores.filter((x) => x.subjectId === subject.id && x.componentId)) {
      ;(map[sc.componentId!] ??= []).push({ got: sc.marksGot, out: sc.outOf })
    }
    return map
  }, [data.scores, subject.id])

  const marks = useMemo(
    () => subjectMarks(subject, scoresByComponent, att.held, att.attended),
    [subject, scoresByComponent, att],
  )

  const scheme = subject.markingScheme ?? []
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [weight, setWeight] = useState(10)
  const [outOf, setOutOf] = useState(10)
  const [expected, setExpected] = useState(1)
  const [bestN, setBestN] = useState(0)
  const [fromAtt, setFromAtt] = useState(false)
  const [scoreEntry, setScoreEntry] = useState<{ compId: string; name?: string; got: string; out: string } | null>(null)

  function saveComponent() {
    if (!label.trim() || weight <= 0) return
    const comp: MarkingComponent = {
      id: newId('mc'),
      label: label.trim(),
      weight,
      ...(fromAtt ? { fromAttendance: true } : { outOf, expectedEntries: expected, ...(bestN > 0 ? { bestN } : {}) }),
    }
    updateSubject(subject.id, { markingScheme: [...scheme, comp] })
    setLabel(''); setWeight(10); setOutOf(10); setExpected(1); setBestN(0); setFromAtt(false); setEditing(false)
  }

  function deleteComponent(id: string) {
    updateSubject(subject.id, { markingScheme: scheme.filter((c) => c.id !== id) })
    // scores belonging to the removed component go with it
    data.scores.filter((s) => s.componentId === id).forEach((s) => removeScore(s.id))
  }

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <b>Marks</b>

      {/* Marks-so-far summary (only once a real score exists) */}
      {marks.showable && marks.percent !== null ? (
        <div className="row spread" style={{ marginTop: 6, alignItems: 'center' }}>
          <span>
            <b className="num big">{marks.percent.toFixed(1)}%</b>{' '}
            <span className="msg">· about {Math.round(marks.marksGot)} of {marks.marksOut} marks</span>
          </span>
          <StatusPill tone="primary">{gradeFromPercent(marks.percent)} <span title="Not the real college grade">rough guide</span></StatusPill>
        </div>
      ) : (
        <div className="msg" style={{ marginTop: 4 }}>Marks so far appear here once you enter at least one test or assignment score.</div>
      )}

      {/* Components */}
      {scheme.length === 0 && !editing && (
        <div className="msg" style={{ marginTop: 6 }}>No marking scheme yet. Build one below — e.g. “Mid-sem exam, worth 9, out of 25”.</div>
      )}
      {scheme.map((c) => {
        const res = marks.results.find((r) => r.componentId === c.id)
        const comps = data.scores.filter((s) => s.subjectId === subject.id && s.componentId === c.id)
        return (
          <div key={c.id} className="card" style={{ marginTop: 8 }}>
            <div className="row spread">
              <b>{c.label}</b>
              <span className="row" style={{ gap: 6 }}>
                {res?.counted && res.fraction !== null && (
                  <StatusPill tone="neutral">{Math.round(res.contribution * 10) / 10} / {c.weight}</StatusPill>
                )}
                <button className="icon-btn" aria-label={`Delete ${c.label}`} onClick={() => deleteComponent(c.id)}>🗑</button>
              </span>
            </div>
            <div className="class-meta">
              worth {c.weight}
              {c.fromAttendance
                ? ` · automatic from attendance (${att.attended}/${att.held})`
                : ` · out of ${c.outOf ?? '?'}${c.expectedEntries ? `, ${c.expectedEntries} entries` : ''}${c.bestN ? `, best ${c.bestN} count` : ''}`}
            </div>

            {!c.fromAttendance && (
              <>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {comps.map((s) => (
                    <span key={s.id} className="pill pill-neutral">
                      {s.name ? `${s.name}: ` : ''}{s.marksGot}/{s.outOf}
                      <button
                        className="score-chip-x"
                        aria-label={`Delete score ${s.name || s.marksGot}`}
                        onClick={() => removeScore(s.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {comps.length === 0 && <span className="msg">No scores yet.</span>}
                </div>
                {scoreEntry?.compId === c.id ? (
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <input className="grow" placeholder="Name (optional)" value={scoreEntry.name ?? ''} onChange={(e) => setScoreEntry({ ...scoreEntry, name: e.target.value })} />
                    <input style={{ width: 70 }} type="number" min={0} placeholder="got" value={scoreEntry.got} onChange={(e) => setScoreEntry({ ...scoreEntry, got: e.target.value })} />
                    <span className="msg">of</span>
                    <input style={{ width: 70 }} type="number" min={1} placeholder={String(c.outOf ?? 10)} value={scoreEntry.out} onChange={(e) => setScoreEntry({ ...scoreEntry, out: e.target.value })} />
                    <button
                      className="primary"
                      onClick={() => {
                        const got = Number(scoreEntry.got)
                        const out = Number(scoreEntry.out || c.outOf || 0)
                        if (Number.isNaN(got) || !(out > 0)) return
                        addScore({ subjectId: subject.id, name: (scoreEntry.name ?? '').trim(), marksGot: got, outOf: out, componentId: c.id })
                        setScoreEntry(null)
                      }}
                    >
                      Add
                    </button>
                    <button onClick={() => setScoreEntry(null)}>✕</button>
                  </div>
                ) : (
                  <button style={{ marginTop: 8 }} onClick={() => setScoreEntry({ compId: c.id, got: '', out: '' })}>+ Score</button>
                )}
              </>
            )}
          </div>
        )
      })}

      {/* Add-component form */}
      {editing ? (
        <div className="card" style={{ marginTop: 8 }}>
          <b>New component</b>
          <input style={{ width: '100%', marginTop: 6 }} placeholder="e.g. Online MCQ tests" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <label className="msg">Worth <input style={{ width: 64 }} type="number" min={1} value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></label>
            {!fromAtt && (
              <>
                <label className="msg">Out of <input style={{ width: 64 }} type="number" min={1} value={outOf} onChange={(e) => setOutOf(Number(e.target.value))} /></label>
                <label className="msg">Entries <input style={{ width: 64 }} type="number" min={1} value={expected} onChange={(e) => setExpected(Number(e.target.value))} /></label>
                <label className="msg">Best N (0=all) <input style={{ width: 64 }} type="number" min={0} value={bestN} onChange={(e) => setBestN(Number(e.target.value))} /></label>
              </>
            )}
          </div>
          <label className="row msg" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={fromAtt} onChange={(e) => setFromAtt(e.target.checked)} />
            Automatic from attendance (cannot be edited by hand)
          </label>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary grow" onClick={saveComponent}>Save component</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={{ marginTop: 8 }} onClick={() => setEditing(true)}>+ Add component</button>
      )}
    </div>
  )
}
