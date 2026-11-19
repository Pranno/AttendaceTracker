// Subjects tab → a subject's syllabus, unit by unit (read by Smart import).
// Each unit opens to show every topic; the other parts of the syllabus
// (outcomes, practicals, books, evaluation, links) sit below as sections.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useApp } from '../data/store'
import { formatShort } from '../logic/dates'
import { openExternal } from './Locker'
import { SectionTitle } from './ui/parts'

function Fold({ title, count, children, startOpen = false }: { title: string; count?: string; children: ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="card syl-fold">
      <button className="syl-fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="grow">
          <b>{title}</b>
          {count && <span className="msg"> · {count}</span>}
        </span>
        <ChevronDown size={18} className={`subj-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && <div className="syl-fold-body">{children}</div>}
    </div>
  )
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className="syl-list">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </Tag>
  )
}

export default function SyllabusView({ subjectId, onImport }: { subjectId: string; onImport: () => void }) {
  const { data, deleteSyllabus } = useApp()
  const syl = data.syllabi.find((s) => s.subjectId === subjectId)
  const [allOpen, setAllOpen] = useState(false)
  const [rev, setRev] = useState(0) // remount folds when "open all" toggles

  if (!syl) {
    return (
      <>
        <SectionTitle>SYLLABUS</SectionTitle>
        <div className="card msg">
          No syllabus yet.{' '}
          <button className="link-btn" onClick={onImport}>Import it with Smart import</button> on the Timetable tab — every unit
          and topic will show here.
        </div>
      </>
    )
  }

  const topicCount = syl.units.reduce((n, u) => n + u.topics.length, 0)
  const imported = syl.importedAt.slice(0, 10)

  return (
    <>
      <SectionTitle>SYLLABUS</SectionTitle>
      <div className="card syl-head">
        <div className="row spread" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <b>{syl.courseName ?? 'Syllabus'}</b>
            <div className="msg">
              {[
                syl.courseCode,
                syl.credits ? `${syl.credits} credits` : '',
                syl.teachingScheme ? `L-T-P ${syl.teachingScheme}` : '',
                `${syl.units.length} units · ${topicCount} topics`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <button
            className="link-btn"
            onClick={() => {
              setAllOpen((o) => !o)
              setRev((r) => r + 1)
            }}
          >
            {allOpen ? 'Close all' : 'Open all'}
          </button>
        </div>
        {syl.prerequisites?.length ? <div className="msg" style={{ marginTop: 6 }}>Prerequisites: {syl.prerequisites.join(', ')}</div> : null}
      </div>

      <div key={rev}>
        {syl.units.map((u, i) => (
          <Fold
            key={i}
            startOpen={allOpen}
            title={`${u.number ? `Unit ${u.number.replace(/^unit\s*/i, '')}: ` : `Unit ${i + 1}: `}${u.title}`}
            count={[`${u.topics.length} topics`, u.hours ? `${u.hours} h` : ''].filter(Boolean).join(' · ')}
          >
            <List items={u.topics} ordered />
            {u.outcomes?.length ? <div className="syl-tags">{u.outcomes.map((o) => <span key={o} className="pill pill-neutral">{o}</span>)}</div> : null}
          </Fold>
        ))}

        {syl.outcomes?.length ? (
          <Fold title="Course outcomes" count={`${syl.outcomes.length}`} startOpen={allOpen}>
            <ul className="syl-list">
              {syl.outcomes.map((o, i) => (
                <li key={i}>{o.code ? <b>{o.code}: </b> : null}{o.text}</li>
              ))}
            </ul>
          </Fold>
        ) : null}
        {syl.objectives?.length ? (
          <Fold title="Objectives" count={`${syl.objectives.length}`} startOpen={allOpen}><List items={syl.objectives} /></Fold>
        ) : null}
        {syl.practicals?.length ? (
          <Fold title="Practicals / lab list" count={`${syl.practicals.length}`} startOpen={allOpen}><List items={syl.practicals} ordered /></Fold>
        ) : null}
        {syl.assessment?.length ? (
          <Fold title="Evaluation scheme" count={`${syl.assessment.length}`} startOpen={allOpen}>
            <ul className="syl-list">
              {syl.assessment.map((a, i) => (
                <li key={i}>{a.component}{a.weight ? <b> — {a.weight}</b> : null}</li>
              ))}
            </ul>
          </Fold>
        ) : null}
        {syl.textbooks?.length ? (
          <Fold title="Text books" count={`${syl.textbooks.length}`} startOpen={allOpen}><List items={syl.textbooks} ordered /></Fold>
        ) : null}
        {syl.references?.length ? (
          <Fold title="Reference books" count={`${syl.references.length}`} startOpen={allOpen}><List items={syl.references} ordered /></Fold>
        ) : null}
        {syl.links?.length ? (
          <Fold title="Online courses & links" count={`${syl.links.length}`} startOpen={allOpen}>
            <ul className="syl-list">
              {syl.links.map((l, i) => (
                <li key={i}>
                  {l.url ? (
                    <a href={l.url} onClick={(e) => { e.preventDefault(); void openExternal(l.url!) }}>{l.name}</a>
                  ) : (
                    l.name
                  )}
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </div>

      <div className="msg syl-foot">
        From “{syl.sourceName}”, imported {formatShort(imported, true)}.{' '}
        <button className="link-btn" onClick={onImport}>Re-import</button>
        <button
          className="link-btn"
          style={{ color: 'var(--danger)' }}
          onClick={() => { if (window.confirm('Remove this syllabus from the subject?')) deleteSyllabus(subjectId) }}
        >
          Remove
        </button>
      </div>
    </>
  )
}
