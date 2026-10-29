// ============================================================
// Study tab — Section E (E1–E10). Exposes logic/study.ts:
//  • "What to revise next" suggestion card (E8)
//  • Exam countdown plans for upcoming unit tests (E7)
//  • Coming-up deadlines in words (E6)
//  • Syllabus units & topics with revise tick-offs (E2–E4)
//  • Practice questions with spaced repetition boxes (E10)
//  • Focus timer logging study sessions + streak (E9)
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../data/store'
import type { PracticeQuestion, Unit } from '../data/model'
import { todayStr, addDays, formatShort } from '../logic/dates'
import { slotsForDate } from '../logic/attendance'
import {
  answerQuestion,
  collectActivityDates,
  describeDeadline,
  dueCount,
  examPlans,
  nextToRevise,
  pickSession,
  studyStreak,
  upcomingDeadlines,
} from '../logic/study'
import { SectionTitle, Sheet, StatusPill } from './ui/parts'
import SpecialCourses from './SpecialCourses'

// ---------------- Focus timer (E9) ----------------
function FocusTimer() {
  const { data, addFocusSession } = useApp()
  const [minutes, setMinutes] = useState(25)
  const [left, setLeft] = useState<number | null>(null)
  const [kind, setKind] = useState<'study' | 'project'>('study')
  const intRef = useRef<number | null>(null)

  useEffect(() => () => { if (intRef.current) window.clearInterval(intRef.current) }, [])

  function start() {
    if (intRef.current) window.clearInterval(intRef.current)
    setLeft(minutes * 60)
    intRef.current = window.setInterval(() => {
      setLeft((l) => {
        if (l === null) return null
        if (l <= 1) {
          if (intRef.current) window.clearInterval(intRef.current)
          intRef.current = null
          addFocusSession(todayStr(), minutes, kind)
          return null
        }
        return l - 1
      })
    }, 1000)
  }

  function stopEarly() {
    if (intRef.current) window.clearInterval(intRef.current)
    intRef.current = null
    if (left !== null) {
      const doneMin = Math.round((minutes * 60 - left) / 60)
      if (doneMin > 0) addFocusSession(todayStr(), doneMin, kind)
    }
    setLeft(null)
  }

  const todayMin = data.focusSessions
    .filter((f) => f.date === todayStr())
    .reduce((n, f) => n + f.minutes, 0)

  return (
    <div className="card">
      <div className="row spread">
        <b>Focus timer</b>
        <span className="msg">{todayMin} min today</span>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        {[15, 25, 45].map((m) => (
          <button key={m} className={minutes === m ? 'secondary' : ''} onClick={() => setMinutes(m)} disabled={left !== null}>
            {m} min
          </button>
        ))}
        <button className={kind === 'project' ? 'secondary' : ''} onClick={() => setKind(kind === 'project' ? 'study' : 'project')} disabled={left !== null}>
          {kind === 'project' ? '🛠 Project' : '📚 Study'}
        </button>
      </div>
      <div className="row spread" style={{ marginTop: 10 }}>
        {left !== null ? (
          <>
            <b className="num big">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>
            <button onClick={stopEarly}>Stop &amp; log</button>
          </>
        ) : (
          <button className="primary grow" onClick={start}>Start focus session</button>
        )}
      </div>
    </div>
  )
}

// ---------------- Units & topics editor (E2–E4) ----------------
function UnitCard({ unit }: { unit: Unit }) {
  const { data, markRevised, upsertTopic, removeTopic, addQuestion, updateQuestion, removeQuestion } = useApp()
  const today = todayStr()
  const [topicInput, setTopicInput] = useState('')
  const [qOpen, setQOpen] = useState(false)
  const [qText, setQText] = useState('')
  const [qAnswer, setQAnswer] = useState('')
  const [session, setSession] = useState<PracticeQuestion[] | null>(null)
  const [revealed, setRevealed] = useState(false)

  const subj = data.subjects.find((s) => s.id === unit.subjectId)
  const revisedTopics = unit.topics.filter((t) => t.revisedDate).length

  function startSession() {
    const qs = unit.questions ?? []
    if (!qs.length) return
    setSession(pickSession(qs, today))
    setRevealed(false)
  }

  function answer(gotIt: boolean) {
    if (!session || session.length === 0) return
    const [cur, ...rest] = session
    updateQuestion(unit.id, answerQuestion(cur, gotIt, today))
    setSession(rest)
    setRevealed(false)
  }

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row spread">
        <b>{subj?.shortName ?? '?'} · {unit.title}</b>
        {unit.revisedDate ? (
          <StatusPill tone="safe">Revised {formatShort(unit.revisedDate)}</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not revised</StatusPill>
        )}
      </div>
      {unit.topics.length > 0 && (
        <div className="msg">Topics revised: {revisedTopics}/{unit.topics.length}</div>
      )}

      {/* topic list with tick buttons (E4) */}
      {unit.topics.map((t) => (
        <div className="row spread" key={t.name} style={{ marginTop: 4 }}>
          <span className="msg">
            {t.revisedDate ? '✅' : '⬜'} {t.name}
            {t.group ? ` · ${t.group}` : ''}
          </span>
          <span className="row" style={{ gap: 4 }}>
            {!t.revisedDate && (
              <button onClick={() => markRevised(unit.id, t.name, today)}>Tick</button>
            )}
            <button aria-label={`Remove ${t.name}`} onClick={() => removeTopic(unit.id, t.name)}>✕</button>
          </span>
        </div>
      ))}

      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <input
          className="grow"
          placeholder="Add a topic…"
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
        />
        <button
          onClick={() => {
            const name = topicInput.trim()
            if (!name) return
            upsertTopic(unit.id, { name, taughtDate: null, revisedDate: null })
            setTopicInput('')
          }}
        >
          Add
        </button>
      </div>

      <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
        {!unit.revisedDate && (
          <button className="secondary" onClick={() => markRevised(unit.id, null, today)}>
            ✓ Whole unit revised
          </button>
        )}
        {(unit.questions?.length ?? 0) > 0 && (
          <button onClick={startSession}>
            Practise questions{dueCount(unit.questions ?? [], today) > 0 ? ` (${dueCount(unit.questions ?? [], today)} to redo)` : ''}
          </button>
        )}
        <button onClick={() => setQOpen(true)}>+ Question</button>
      </div>

      {/* spaced-repetition session modal (E10) */}
      <Sheet open={session !== null} onClose={() => setSession(null)} title="Practice session">
        {session && session.length > 0 ? (
          <div>
            <b>{session[0].text}</b>
            {revealed ? (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="small-label">Answer</div>
                <div>{session[0].answer || <i>(no answer recorded)</i>}</div>
              </div>
            ) : (
              <button className="secondary" style={{ marginTop: 8 }} onClick={() => setRevealed(true)}>
                Show answer
              </button>
            )}
            {revealed && (
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button className="primary grow" onClick={() => answer(true)}>Got it ✓</button>
                <button onClick={() => answer(false)}>Missed ✗</button>
              </div>
            )}
            <div className="msg" style={{ marginTop: 8 }}>{session.length} left · box {session[0].box}/4</div>
          </div>
        ) : (
          <div className="msg">Session complete — nice work. 🎉</div>
        )}
      </Sheet>

      {/* add question sheet */}
      <Sheet open={qOpen} onClose={() => setQOpen(false)} title="New practice question">
        <label>Question</label>
        <textarea rows={3} style={{ width: '100%' }} value={qText} onChange={(e) => setQText(e.target.value)} />
        <label style={{ marginTop: 8 }}>Answer</label>
        <textarea rows={2} style={{ width: '100%' }} value={qAnswer} onChange={(e) => setQAnswer(e.target.value)} />
        <button
          className="primary"
          style={{ marginTop: 10 }}
          onClick={() => {
            if (!qText.trim()) return
            addQuestion(unit.id, {
              text: qText.trim(), answer: qAnswer.trim(), box: 0,
              dueOn: addDays(today, 1), lastAnswerOn: null,
            })
            setQText(''); setQAnswer(''); setQOpen(false)
          }}
        >
          Save question
        </button>
        {(unit.questions?.length ?? 0) > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="small-label">Saved ({unit.questions!.length})</div>
            {unit.questions!.map((q) => (
              <div className="row spread" key={q.id} style={{ marginTop: 4 }}>
                <span className="msg">{q.text.slice(0, 40)} · box {q.box}</span>
                <button aria-label="Delete question" onClick={() => removeQuestion(unit.id, q.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}

// ---------------- main screen ----------------
export default function Study() {
  const { data, addUnit, deleteUnit } = useApp()
  const today = todayStr()

  const suggestion = useMemo(() => {
    const todays = slotsForDate(data, today)
      .map((s) => data.subjects.find((x) => x.id === s.subjectId)?.shortName ?? '')
      .filter(Boolean)
    return nextToRevise(data, [...new Set(todays)], today)
  }, [data, today])

  const plans = useMemo(() => examPlans(data, today), [data, today])
  const comingUp = useMemo(() => upcomingDeadlines(data, 3, today), [data, today])
  const streak = useMemo(() => studyStreak(collectActivityDates(data), today), [data, today])

  const [newUnitSubj, setNewUnitSubj] = useState(data.subjects[0]?.id ?? '')
  const [newUnitTitle, setNewUnitTitle] = useState('')

  const unitsBySubject = useMemo(() => {
    const map = new Map<string, Unit[]>()
    for (const u of data.units) {
      const list = map.get(u.subjectId) ?? []
      list.push(u)
      map.set(u.subjectId, list)
    }
    return map
  }, [data.units])

  return (
    <div className="screen pad">
      <h1 style={{ margin: '8px 0 4px' }}>Study</h1>

      {/* E9 streak */}
      <div className="card row spread">
        <b>🔥 {streak.count}-day study streak</b>
        <span className="msg">{streak.todayActive ? 'Active today ✓' : 'Study today to keep it going.'}</span>
      </div>

      {/* E8 what to revise next */}
      <SectionTitle>WHAT TO REVISE NEXT</SectionTitle>
      <div className="card">
        {suggestion === 'no-units' && <div className="msg">Add your syllabus units below and the app will tell you what to revise.</div>}
        {suggestion === 'all-done' && <div>Everything is revised. 🎉 Revisit weak units with their practice questions.</div>}
        {typeof suggestion === 'object' && (
          <>
            <b>
              {suggestion.action === 'redo' ? '📝 Redo' : suggestion.action === 'refresh' ? '🔄 Refresh' : '📖 Revise'}{' '}
              {suggestion.subjectShort}: {suggestion.unitTitle}
            </b>
            <div className="msg" style={{ marginTop: 4 }}>{suggestion.reason}</div>
          </>
        )}
      </div>

      {/* E7 exam countdown plans */}
      {plans.length > 0 && (
        <>
          <SectionTitle>EXAM COUNTDOWN</SectionTitle>
          {plans.map((p) => (
            <div className="card" key={p.deadlineId}>
              <div className="row spread">
                <b>{p.title}</b>
                <StatusPill tone={p.inDays <= 2 ? 'below' : 'limit'}>{p.inDays === 0 ? 'today' : `in ${p.inDays}d`}</StatusPill>
              </div>
              {p.days.map((d) => (
                <div key={d.date} style={{ marginTop: 6 }}>
                  <div className="small-label">{d.label}{d.isTestDay ? ' · TEST' : ''}</div>
                  {d.items.map((it, i) => (
                    <div className="msg" key={i}>• {it}</div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {/* E6 coming up deadlines in words */}
      {comingUp.length > 0 && (
        <>
          <SectionTitle>COMING UP</SectionTitle>
          {comingUp.map((d) => (
            <div className="card row spread" key={d.id}>
              <div>
                <b>{d.title}</b>
                <div className="msg">{describeDeadline(d, today)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* E9 focus timer */}
      <SectionTitle>FOCUS</SectionTitle>
      <FocusTimer />

      {/* E2 syllabus units */}
      <SectionTitle>SYLLABUS UNITS</SectionTitle>
      {data.subjects.length === 0 && <div className="card msg">Add subjects first (Subjects tab or import the timetable).</div>}
      {data.subjects.map((s) => {
        const units = unitsBySubject.get(s.id) ?? []
        return (
          <div key={s.id}>
            {units.length > 0 && <div className="small-label" style={{ marginTop: 10 }}>{s.shortName} — {s.fullName}</div>}
            {units.map((u) => (
              <div key={u.id} className="row" style={{ gap: 4, alignItems: 'stretch' }}>
                <div className="grow">
                  <UnitCard unit={u} />
                </div>
                <button className="icon-btn" aria-label="Delete unit" onClick={() => deleteUnit(u.id)}>🗑</button>
              </div>
            ))}
          </div>
        )
      })}
      <div className="card" style={{ marginTop: 10 }}>
        <b>Add a unit</b>
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          <select className="grow" value={newUnitSubj} onChange={(e) => setNewUnitSubj(e.target.value)}>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.shortName}</option>
            ))}
          </select>
          <input className="grow" placeholder="e.g. Unit 1: Limits" value={newUnitTitle} onChange={(e) => setNewUnitTitle(e.target.value)} />
        </div>
        <button
          className="primary"
          style={{ marginTop: 8 }}
          disabled={!newUnitSubj || !newUnitTitle.trim()}
          onClick={() => {
            addUnit({ subjectId: newUnitSubj, title: newUnitTitle.trim(), hoursInClass: 0, revisedDate: null, kind: 'unit' })
            setNewUnitTitle('')
          }}
        >
          Add unit
        </button>
      </div>

      {/* Section H: special courses (links, status, certificates) */}
      <SpecialCourses />
    </div>
  )
}
