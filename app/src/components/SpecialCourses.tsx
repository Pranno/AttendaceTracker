// ============================================================
// Special courses screen (Section H) — part of the Syllabus tab.
// H1 overview of all subjects + per-subject list grouped by unit,
// H2 name/platform/unit/CO/status/Open, H3 opens in browser,
// H5 add/edit/delete by hand, H6 status with date + "N of M completed",
// H7 filter by subject/status + search, H8 certificate tick + deadline
// progress, H9 entries without a link, H10 offline list.
// ============================================================

import { useMemo, useState } from 'react'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '../data/store'
import type { CourseLink } from '../data/model'
import { courseOverview, groupByUnit, normalizeUrl } from '../logic/courseLinks'
import { todayStr } from '../logic/dates'
import { SectionTitle, StatusPill, ChipRow } from './ui/parts'

type StatusFilter = 'all' | CourseLink['status']
/** H7: the subject filter also has an "All subjects" entry. */
type SubjectFilter = string

interface FormState {
  id?: string
  subjectId: string
  name: string
  platform: string
  url: string
  unitTitle: string
  coNumber: string
}

const EMPTY_FORM: FormState = { subjectId: '', name: '', platform: 'Infosys Springboard', url: '', unitTitle: '', coNumber: '' }

export default function SpecialCourses() {
  const { data, addCourseLink, updateCourseLink, deleteCourseLink, setCourseStatus, setCertificateSubmitted } = useApp()
  const today = todayStr()

  const [selSubject, setSelSubject] = useState<SubjectFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState | null>(null)

  const links = data.courseLinks

  // H1: overview line per subject ("WAD: 8 courses, 3 completed")
  const overview = useMemo(() => courseOverview(data.subjects, links), [data.subjects, links])

  // H7: filter + search
  const visibleSubjects = selSubject === 'all' ? overview.filter((o) => o.total > 0) : overview.filter((o) => o.subjectId === selSubject)

  const filteredLinks = (subjectId: string) =>
    links
      .filter((c) => c.subjectId === subjectId)
      .filter((c) => statusFilter === 'all' || c.status === statusFilter)
      .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()))

  function openUrl(c: CourseLink) {
    const u = normalizeUrl(c.url)
    if (!u) return
    // H3: phone browser / installed app handles the intent; web uses a new tab.
    window.open(u, '_blank', 'noopener')
  }

  function saveForm() {
    if (!form || !form.name.trim() || !form.subjectId) return
    const base = {
      subjectId: form.subjectId,
      name: form.name.trim(),
      platform: form.platform.trim() || 'Other',
      url: form.url.trim(),
      unitTitle: form.unitTitle.trim() || undefined,
      coNumber: form.coNumber.trim() || undefined,
      needsChecking: false,
    }
    if (form.id) {
      updateCourseLink(form.id, base)
    } else {
      addCourseLink({ ...base, status: 'not started' })
    }
    setForm(null)
  }

  return (
    <div>
      {/* H1 overview */}
      <SectionTitle>SPECIAL COURSES</SectionTitle>
      {overview.length === 0 && (
        <div className="card msg">
          No course links yet. Add Infosys Springboard / other courses here so they open with one tap.
        </div>
      )}
      {overview.length > 0 && (
        <div className="card">
          {overview.map((o) => (
            <button
              key={o.subjectId}
              className="row spread"
              style={{ width: '100%', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => setSelSubject(selSubject === o.subjectId ? 'all' : o.subjectId)}
            >
              <span>
                <b>{o.shortName}</b>{' '}
                <span className="msg">
                  {o.total} course{o.total === 1 ? '' : 's'}, {o.completed} completed
                </span>
                {o.needsLink > 0 && <span className="msg"> · {o.needsLink} need a link ⚠️</span>}
              </span>
              <StatusPill tone={o.completed === o.total ? 'safe' : 'neutral'}>
                {o.completed}/{o.total}
              </StatusPill>
            </button>
          ))}
        </div>
      )}

      {/* H7 filters */}
      {overview.length > 0 && (
        <>
          <ChipRow
            options={[{ id: 'all', label: 'All subjects' }, ...overview.map((o) => ({ id: o.subjectId, label: o.shortName }))]}
            value={selSubject}
            onChange={setSelSubject}
          />
          <ChipRow
            options={[
              { id: 'all', label: 'Any status' },
              { id: 'not started', label: 'Not started' },
              { id: 'started', label: 'Started' },
              { id: 'completed', label: 'Completed' },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
          <input
            placeholder="Search course name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
        </>
      )}

      <button className="primary" style={{ marginBottom: 10 }} onClick={() => setForm({ ...EMPTY_FORM, subjectId: selSubject !== 'all' ? selSubject : data.subjects[0]?.id ?? '' })}>
        + Add course link
      </button>

      {/* H5 add/edit form */}
      {form && (
        <div className="card" style={{ marginBottom: 10 }}>
          <b>{form.id ? 'Edit course' : 'New course'}</b>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HTML Basics" />
          <div className="field-row">
            <div className="grow">
              <label>Subject</label>
              <select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                {data.subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.shortName}</option>
                ))}
              </select>
            </div>
            <div className="grow">
              <label>Platform</label>
              <input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Infosys Springboard" />
            </div>
          </div>
          <div className="field-row">
            <div className="grow">
              <label>Unit heading</label>
              <input value={form.unitTitle} onChange={(e) => setForm({ ...form, unitTitle: e.target.value })} placeholder="Unit 1: Introduction & HTML" />
            </div>
            <div className="grow">
              <label>CO number</label>
              <input value={form.coNumber} onChange={(e) => setForm({ ...form, coNumber: e.target.value })} placeholder="CO1" />
            </div>
          </div>
          <label>Web address (leave empty to add later — H9)</label>
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary grow" onClick={saveForm}>Save</button>
            <button onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* H1: per-subject lists grouped by unit */}
      {visibleSubjects.map((o) => {
        const mine = filteredLinks(o.subjectId)
        const groups = groupByUnit(mine)
        return (
          <div key={o.subjectId} style={{ marginBottom: 12 }}>
            <SectionTitle>{o.shortName.toUpperCase()} — {o.completed} of {o.total} completed</SectionTitle>
            {groups.length === 0 && <div className="card msg">Nothing matches the current filter.</div>}
            {groups.map((g) => (
              <div key={g.unit} className="card" style={{ marginBottom: 6 }}>
                <b>{g.unit}</b>
                {g.courses.map((c) => (
                  <div key={c.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                    <div className="row spread">
                      <span style={{ minWidth: 0 }}>
                        <b>{c.name}</b>
                        <div className="msg">
                          {c.platform}
                          {c.coNumber ? ` · ${c.coNumber}` : ''}
                          {c.completedDate ? ` · done ${c.completedDate}` : ''}
                          {c.certificateSubmittedDate ? ` · cert ✓ ${c.certificateSubmittedDate}` : ''}
                        </div>
                      </span>
                      <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                        {/* H3 Open button — dimmed when no link yet (H9) */}
                        <button
                          className="icon-btn"
                          aria-label="Open link"
                          disabled={!c.url}
                          title={c.url ? 'Open in browser' : 'No link yet — edit to add one'}
                          onClick={() => openUrl(c)}
                          style={c.needsChecking ? { color: 'var(--warning)' } : undefined}
                        >
                          <ExternalLink size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Edit"
                          onClick={() =>
                            setForm({
                              id: c.id,
                              subjectId: c.subjectId,
                              name: c.name,
                              platform: c.platform,
                              url: c.url,
                              unitTitle: c.unitTitle ?? '',
                              coNumber: c.coNumber ?? '',
                            })
                          }
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Delete"
                          onClick={() => {
                            if (window.confirm(`Delete "${c.name}"?`)) deleteCourseLink(c.id)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                    {c.needsChecking && (
                      <div className="msg" style={{ color: 'var(--warning)' }}>⚠ check link — tap ✎ to paste the correct address</div>
                    )}
                    <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {/* H6 status chips with date */}
                      {(['not started', 'started', 'completed'] as const).map((st) => (
                        <button
                          key={st}
                          className={`chip${c.status === st ? ' chip on' : ''}`}
                          onClick={() => setCourseStatus(c.id, st, today)}
                        >
                          {st}
                        </button>
                      ))}
                      {/* H8 certificate tick with date */}
                      <button
                        className={`chip${c.certificateSubmittedDate ? ' chip on' : ''}`}
                        onClick={() => setCertificateSubmitted(c.id, c.certificateSubmittedDate ? null : today)}
                      >
                        📜 certificate submitted
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      })}

      <div className="msg" style={{ marginTop: 8 }}>The list works offline; opening a link needs the internet.</div>
    </div>
  )
}
