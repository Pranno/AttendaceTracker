// Timetable tab → "Import syllabus (Smart AI)".
// Gemini reads a syllabus PDF/photo (one course or a whole semester book);
// each course found is matched to one of your subjects, you check the match,
// and it is saved under that subject (shown unit by unit on the Subjects tab).

import { useState } from 'react'
import { useApp } from '../data/store'
import { hasGeminiKey } from '../logic/gemini'
import { normalizeUrl } from '../logic/courseLinks'
import { isSmartReadable, matchCourseToSubject, smartReadSyllabus, syllabusFor, type SmartCourse } from '../logic/smartImport'

interface Pick {
  course: SmartCourse
  subjectId: string // '' = don't save
  open: boolean
}

export default function SyllabusImport() {
  const { data, setSyllabus, addCourseLink } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [source, setSource] = useState('')

  async function read(f: File | undefined) {
    if (!f) return
    setError(null)
    setDone(null)
    setPicks(null)
    if (!isSmartReadable(f)) {
      setError('Smart import reads PDFs and photos (JPG/PNG).')
      return
    }
    setBusy(true)
    try {
      const courses = await smartReadSyllabus(f)
      if (courses.length === 0) {
        setError('No course syllabus was found in this file.')
        return
      }
      const used = new Set<string>()
      setPicks(
        courses.map((course) => {
          const id = matchCourseToSubject(course, data.subjects)
          // never pre-assign two courses to the same subject
          const subjectId = id && !used.has(id) ? id : ''
          if (subjectId) used.add(subjectId)
          return { course, subjectId, open: false }
        }),
      )
      setSource(f.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smart import failed.')
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!picks) return
    const chosen = picks.filter((p) => p.subjectId)
    let links = 0
    for (const p of chosen) {
      setSyllabus(syllabusFor(p.course, p.subjectId, source))
      // Every course link in the syllabus goes straight into that subject's
      // Locker → Links (names without a web address too, as "no link yet").
      for (const l of p.course.links ?? []) {
        const url = l.url ? normalizeUrl(l.url) : ''
        let host = ''
        if (url) {
          try {
            host = new URL(url).hostname.replace(/^www\./, '')
          } catch {
            host = ''
          }
        }
        const name = l.name.trim()
        const exists = data.courseLinks.some(
          (c) =>
            c.subjectId === p.subjectId &&
            ((url && host && normalizeUrl(c.url) === url) || c.name.trim().toLowerCase() === name.toLowerCase()),
        )
        if (exists || !name) continue
        addCourseLink({
          subjectId: p.subjectId,
          name,
          platform: host,
          url: host ? url : '',
          status: 'not started',
          needsChecking: !host,
        })
        links += 1
      }
    }
    const names = chosen.map((p) => data.subjects.find((s) => s.id === p.subjectId)?.shortName).filter(Boolean)
    setDone(
      `Saved the syllabus for ${names.join(', ')}.` +
        (links ? ` Added ${links} course link${links === 1 ? '' : 's'} to Locker.` : '') +
        ' Open a subject on the Subjects tab to see it.',
    )
    setPicks(null)
  }

  const subjectHasSyllabus = (id: string) => data.syllabi.some((s) => s.subjectId === id)
  const takenBy = (id: string, self: Pick) => picks?.some((p) => p !== self && p.subjectId === id)

  if (!open) {
    return (
      <button className="secondary" style={{ marginBottom: 12, width: '100%' }} onClick={() => setOpen(true)}>
        ✨ Import syllabus (Smart AI)
      </button>
    )
  }

  return (
    <div className="card syllabus-import">
      <b>Import syllabus</b>
      <div className="msg" style={{ margin: '6px 0' }}>
        Upload a syllabus PDF (one subject or the whole semester) or a photo of it. Gemini reads every unit and topic;
        you choose which subject each course belongs to before saving.
      </div>

      {data.subjects.length === 0 ? (
        <div className="card msg">Add your subjects first (import your timetable above) — each syllabus is saved under a subject.</div>
      ) : !hasGeminiKey() ? (
        <div className="card msg" style={{ color: 'var(--danger)' }}>
          Syllabus import uses Smart import (AI). Add your Gemini API key in <b>Settings → Smart import (AI)</b> — there’s a
          step-by-step guide there.
        </div>
      ) : (
        <input
          type="file"
          accept="application/pdf,.pdf,image/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void read(f)
          }}
        />
      )}
      {busy && <div className="smart-busy">Reading the syllabus with Gemini… a long PDF can take a minute or two.</div>}
      {error && <div className="msg" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      {done && <div className="msg" style={{ color: 'var(--safe)', marginTop: 8, fontWeight: 600 }}>{done}</div>}

      {picks && (
        <>
          <div className="small-label" style={{ marginTop: 12 }}>
            Found {picks.length} course{picks.length === 1 ? '' : 's'} — check where each one goes
          </div>
          {picks.map((p, i) => {
            const topics = p.course.units.reduce((n, u) => n + u.topics.length, 0)
            return (
              <div key={i} className="syllabus-pick">
                <div className="row spread" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <b>{p.course.courseName ?? p.course.courseCode ?? 'Course'}</b>
                    <div className="msg">
                      {[p.course.shortName, p.course.courseCode].filter(Boolean).join(' · ')}
                      {p.course.shortName || p.course.courseCode ? ' · ' : ''}
                      {p.course.units.length} unit{p.course.units.length === 1 ? '' : 's'} · {topics} topics
                    </div>
                  </div>
                  <button
                    className="link-btn"
                    onClick={() => setPicks(picks.map((x) => (x === p ? { ...x, open: !x.open } : x)))}
                  >
                    {p.open ? 'Hide' : 'Preview'}
                  </button>
                </div>
                {p.open && (
                  <ol className="syllabus-preview">
                    {p.course.units.map((u, j) => (
                      <li key={j}>
                        <b>{u.title}</b> <span className="msg">({u.topics.length} topics{u.hours ? `, ${u.hours} h` : ''})</span>
                      </li>
                    ))}
                  </ol>
                )}
                <label className="syllabus-target">
                  <span className="msg">Save under</span>
                  <select
                    value={p.subjectId}
                    onChange={(e) => setPicks(picks.map((x) => (x === p ? { ...x, subjectId: e.target.value } : x)))}
                  >
                    <option value="">Don’t save</option>
                    {data.subjects.map((s) => (
                      <option key={s.id} value={s.id} disabled={takenBy(s.id, p)}>
                        {s.shortName}
                        {s.fullName !== s.shortName ? ` — ${s.fullName}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {p.subjectId && subjectHasSyllabus(p.subjectId) && (
                  <div className="msg" style={{ color: 'var(--limit)' }}>Replaces the syllabus already saved for this subject.</div>
                )}
              </div>
            )
          })}
          {picks.some((p) => p.subjectId && (p.course.links ?? []).length > 0) && (
            <div className="msg" style={{ marginTop: 8 }}>
              Course links in the syllabus will be added to each subject’s Locker → Links.
            </div>
          )}
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="grow" onClick={() => setPicks(null)}>Discard</button>
            <button className="primary grow" onClick={save} disabled={!picks.some((p) => p.subjectId)}>
              Save {picks.filter((p) => p.subjectId).length} syllabus{picks.filter((p) => p.subjectId).length === 1 ? '' : 'es'}
            </button>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => { setOpen(false); setPicks(null); setError(null); setDone(null) }}>Close</button>
      </div>
    </div>
  )
}
