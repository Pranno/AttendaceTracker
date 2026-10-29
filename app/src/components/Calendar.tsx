// Calendar screen (Step 5): month view (C1), day sheet with classes & marks
// (C2, B9), unmarked-past dot (C3), future cancel in advance (C4), deadline
// add/edit/delete from the day (C5), Today jump (C6), mark-all-present (B10)
// and quick actions (F14).

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCheck, Pencil, Trash2, Plus, ClipboardPaste } from 'lucide-react'
import PasteDeadlineSheet from './PasteDeadlineSheet'
import { useApp } from '../data/store'
import type { CourseLink, DateStr, Deadline, MarkStatus } from '../data/model'
import { slotsForDate, isHoliday, markFor } from '../logic/attendance'
import { deadlineCourseProgress } from '../logic/courseLinks'
import { toDate, todayStr, pad2, formatShort } from '../logic/dates'
import { Sheet, SectionTitle } from './ui/parts'
import { subjectPalette } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export default function Calendar() {
  const { data, setMark, updateDeadline, toggleDeadlineDone, deleteDeadline, addDeadline, setDeadlineCourseLinks } = useApp()
  const { active } = useTheme()
  const today = todayStr()
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = toDate(today)
    return { y: d.getFullYear(), m: d.getMonth() } // m: 0-11
  })
  const [openDate, setOpenDate] = useState<DateStr | null>(null)
  /** null = closed; 'new' = adding; otherwise editing that deadline id. */
  const [dlEditorId, setDlEditorId] = useState<string | 'new' | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)

  useEffect(() => {
    // Keep the visible month in sync with "today" on first mount after a date change.
    const d = toDate(today)
    setMonthAnchor((a) => (a.y === d.getFullYear() && a.m === d.getMonth() ? a : { y: d.getFullYear(), m: d.getMonth() }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cells = useMemo(() => {
    const first = new Date(monthAnchor.y, monthAnchor.m, 1)
    // Monday-first grid offset
    const lead = (first.getDay() + 6) % 7
    const daysInMonth = new Date(monthAnchor.y, monthAnchor.m + 1, 0).getDate()
    const out: (DateStr | null)[] = []
    for (let i = 0; i < lead; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${monthAnchor.y}-${pad2(monthAnchor.m + 1)}-${pad2(d)}`)
    }
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [monthAnchor])

  function shiftMonth(n: number) {
    setMonthAnchor((a) => {
      const d = new Date(a.y, a.m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  function jumpToday() {
    const d = toDate(today)
    setMonthAnchor({ y: d.getFullYear(), m: d.getMonth() })
    setOpenDate(today)
  }

  const subjIndex = (id: string) => Math.max(0, data.subjects.findIndex((s) => s.id === id))

  function dotsFor(date: DateStr): string[] {
    const colors: string[] = []
    if (!isHoliday(data, date)) {
      let unmarked = false
      for (const slot of slotsForDate(data, date)) {
        const pal = subjectPalette(subjIndex(slot.subjectId))
        colors.push(pal.strong)
        if (date < today && !markFor(data, date, slot.id)) unmarked = true // C3
      }
      if (unmarked) colors.push('var(--limit)') // C3: past day not fully marked
    } else {
      colors.push('var(--soft)')
    }
    for (const dl of data.deadlines) {
      if (dl.dueDate === date && !dl.done) colors.push('var(--highlight)')
    }
    const seen = new Set<string>()
    return colors.filter((c) => (seen.has(c) ? false : (seen.add(c), true))).slice(0, 4)
  }

  const monthName = new Date(monthAnchor.y, monthAnchor.m, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  const daySlots = openDate
    ? isHoliday(data, openDate)
      ? []
      : slotsForDate(data, openDate).sort((a, b) => a.startTime.localeCompare(b.startTime))
    : []
  const dayDeadlines = openDate ? data.deadlines.filter((d) => d.dueDate === openDate) : []
  const isPast = openDate !== null && openDate < today
  const isFuture = openDate !== null && openDate > today

  function mark(slotId: string, status: MarkStatus | null) {
    if (!openDate) return
    setMark(openDate, slotId, status)
    navigator.vibrate?.(10)
  }

  /** B10: mark every class on this day present. */
  function markAllPresent() {
    if (!openDate) return
    for (const slot of daySlots) {
      if (!markFor(data, openDate, slot.id)) setMark(openDate, slot.id, 'present')
    }
    navigator.vibrate?.(15)
  }

  const editing: Deadline | null =
    dlEditorId === 'new'
      ? {
          id: 'new',
          title: '',
          dueDate: openDate ?? today,
          tentative: false,
          done: false,
          reminderDates: [],
        }
      : dlEditorId
        ? data.deadlines.find((x) => x.id === dlEditorId) ?? null
        : null

  return (
    <div className="screen pad">
      <div className="row spread" style={{ margin: '8px 0 12px' }}>
        <h1 style={{ margin: 0 }}>Calendar</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary small-btn" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste size={15} /> Paste
          </button>
          <button className="secondary small-btn" onClick={jumpToday}>Today</button>{/* C6 */}
        </div>
      </div>

      <div className="card cal-card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <b style={{ fontSize: 18 }}>{monthName}</b>
          <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="cal-head">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <span key={d} className="small-label">{d}</span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} />
            const isToday = date === today
            const dayNum = toDate(date).getDate()
            return (
              <button
                key={date}
                className={`cal-day ${isToday ? 'today' : ''}`}
                onClick={() => { setOpenDate(date); setDlEditorId(null) }}
                aria-label={date}
              >
                <span className={`num ${isToday ? 'today-num' : ''}`}>{dayNum}</span>
                <span className="cal-dots">
                  {dotsFor(date).map((c, j) => (
                    <i key={j} style={{ background: c }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <SectionTitle>LEGEND</SectionTitle>
      <div className="card row" style={{ flexWrap: 'wrap', gap: 10 }}>
        {data.subjects.map((s, i) => (
          <span key={s.id} className="row" style={{ gap: 4 }}>
            <i style={{ width: 10, height: 10, borderRadius: 99, background: subjectPalette(i).strong, display: 'inline-block' }} />
            <span className="msg">{s.shortName}</span>
          </span>
        ))}
        <span className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--highlight)', display: 'inline-block' }} />
          <span className="msg">Deadline</span>
        </span>
        <span className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--limit)', display: 'inline-block' }} />
          <span className="msg">Not marked yet</span>
        </span>
      </div>

      <Sheet open={openDate !== null} onClose={() => { setOpenDate(null); setDlEditorId(null) }}
        title={openDate ? `${formatShort(openDate)}${openDate === today ? ' · today' : isPast ? ' · past' : ''}` : ''}>
        {openDate && !editing && (
          <div>
            {isHoliday(data, openDate) && <div className="card empty-card">🎉 Holiday — no classes.</div>}
            {daySlots.length === 0 && !isHoliday(data, openDate) && (
              <div className="card empty-card">No classes on this day.</div>
            )}

            {/* B10 + F14 quick actions */}
            {data.settings.showQuickActions && daySlots.length > 0 && (
              <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                {!isPast && (
                  <button className="secondary big-btn grow" onClick={markAllPresent}>
                    <CheckCheck size={16} /> Mark all present
                  </button>
                )}
                <button className="secondary big-btn grow" onClick={() => setDlEditorId('new')}>
                  <Plus size={16} /> Add deadline
                </button>
              </div>
            )}

            {daySlots.map((slot) => {
              const subj = data.subjects.find((s) => s.id === slot.subjectId)
              const status = markFor(data, openDate, slot.id)
              const idx = subjIndex(slot.subjectId)
              const dark = active === 'midnight'
              const pal = subjectPalette(idx)
              const showRT = data.settings.showRoomTeacher && (slot.room || slot.teacher)
              return (
                <div
                  className="class-card card-like"
                  key={slot.id}
                  style={{ background: dark ? `color-mix(in srgb, ${pal.strong} 25%, #2A1E3A)` : pal.softBg }}
                >
                  <b style={{ color: pal.strong }}>{subj?.shortName}</b>
                  <div className="class-meta">
                    {slot.startTime}–{slot.endTime} · {slot.type}
                    {showRT && <> · {slot.room}{slot.room && slot.teacher ? ', ' : ''}{slot.teacher}</>}
                  </div>
                  {status ? (
                    <div className="row mark-row">
                      <span className={`status-chip ${status}`}>
                        {status === 'cancelled' ? 'Cancelled' : status === 'noclass' ? 'No class' : status === 'present' ? 'Present' : 'Absent'}
                      </span>
                      <button className="link-btn" onClick={() => mark(slot.id, null)}>Change</button>{/* B1 */}
                    </div>
                  ) : (
                    <div className="row mark-row">
                      <button className="mark present" onClick={() => mark(slot.id, 'present')}>Present</button>
                      <button className="mark absent" onClick={() => mark(slot.id, 'absent')}>Absent</button>
                      {isFuture ? (
                        /* C4: cancel a future class in advance */
                        <button className="mark noclass" onClick={() => mark(slot.id, 'cancelled')}>Cancel</button>
                      ) : (
                        <button className="mark noclass" onClick={() => mark(slot.id, 'noclass')}>No class</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {dayDeadlines.length > 0 && <SectionTitle>DEADLINES</SectionTitle>}
            {dayDeadlines.map((dl) => {
              // H8: "6 of 10 done" when course links are attached to this deadline.
              const cp = deadlineCourseProgress(dl, data.courseLinks)
              return (
              <div key={dl.id} style={{ marginBottom: 8 }}>
              <div className="card row spread">
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={dl.done} onChange={() => toggleDeadlineDone(dl.id)} />
                  <span><b style={dl.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>⏰ {dl.title}</b>
                    <span className="msg" style={{ marginLeft: 8 }}>{dl.time ?? (dl.tentative ? 'tentative' : 'due')}</span></span>
                </label>
                <span className="row" style={{ gap: 4 }}>
                  <button className="icon-btn" aria-label="Edit deadline" onClick={() => setDlEditorId(dl.id)}><Pencil size={15} /></button>
                  <button className="icon-btn" aria-label="Delete deadline" onClick={() => deleteDeadline(dl.id)}><Trash2 size={15} /></button>
                </span>
              </div>
              {cp && (
                <div className="msg" style={{ marginTop: 4, paddingLeft: 4 }}>
                  🎓 {cp.label}{cp.done === cp.total ? ' ✓' : ''}
                </div>
              )}
              </div>
              )
            })}
          </div>
        )}

        {/* C5: add / edit a deadline right from the day */}
        {openDate && editing && (
          <DeadlineForm
            initial={editing}
            defaultDate={openDate}
            subjects={data.subjects.map((s) => ({ id: s.id, name: s.shortName }))}
            courseLinks={data.courseLinks.filter((c) => !editing.subjectId || c.subjectId === editing.subjectId)}
            onCancel={() => setDlEditorId(null)}
            onSave={(patch, linkIds) => {
              if (dlEditorId === 'new') {
                const id = `dl-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
                addDeadline({
                  title: patch.title,
                  dueDate: patch.dueDate,
                  time: patch.time,
                  notes: patch.notes,
                  subjectId: patch.subjectId,
                }, id)
                // H8: attach chosen course links to the new deadline.
                if (linkIds && linkIds.length > 0) setDeadlineCourseLinks(id, linkIds)
              } else if (dlEditorId) {
                updateDeadline(dlEditorId, patch)
                if (linkIds !== undefined) setDeadlineCourseLinks(dlEditorId, linkIds)
              }
              setDlEditorId(null)
            }}
          />
        )}
      </Sheet>
      <PasteDeadlineSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  )
}

interface DlDraft {
  title: string
  dueDate: DateStr
  time?: string
  notes?: string
  subjectId?: string
}

function DeadlineForm({
  initial,
  defaultDate,
  subjects,
  courseLinks = [],
  onCancel,
  onSave,
}: {
  initial: Deadline
  defaultDate: DateStr
  subjects: { id: string; name: string }[]
  /** H8: this subject's special-course links, to attach to the deadline. */
  courseLinks?: CourseLink[]
  onCancel: () => void
  /** linkIds is undefined when the form can't manage links (no courses offered). */
  onSave: (d: DlDraft, linkIds?: string[]) => void
}) {
  const [draft, setDraft] = useState<DlDraft>({
    title: initial.title,
    dueDate: initial.dueDate || defaultDate,
    time: initial.time,
    notes: initial.notes,
    subjectId: initial.subjectId,
  })
  // H8: checkboxes for attaching course links ("WAD certificates: 6 of 10 done").
  const [linkSel, setLinkSel] = useState<string[]>(initial.courseLinkIds ?? [])
  const valid = draft.title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)
  return (
    <div className="card">
      <b>{initial.id === 'new' ? 'New deadline' : 'Edit deadline'}</b>
      <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
        <div>
          <label className="small-label">Title</label>
          <input
            value={draft.title}
            placeholder="e.g. Maths submission"
            onChange={(e) => setDraft((x) => ({ ...x, title: e.target.value }))}
          />
        </div>
        <div className="field-row">
          <div className="grow">
            <label className="small-label">Due date</label>
            <input type="date" value={draft.dueDate} onChange={(e) => setDraft((x) => ({ ...x, dueDate: e.target.value }))} />
          </div>
          <div className="grow">
            <label className="small-label">Time (optional)</label>
            <input type="time" value={draft.time ?? ''} onChange={(e) => setDraft((x) => ({ ...x, time: e.target.value || undefined }))} />
          </div>
        </div>
        {subjects.length > 0 && (
          <div>
            <label className="small-label">Subject (optional)</label>
            <select
              value={draft.subjectId ?? ''}
              onChange={(e) => setDraft((x) => ({ ...x, subjectId: e.target.value || undefined }))}
            >
              <option value="">— none —</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="small-label">Notes (optional)</label>
          <input value={draft.notes ?? ''} onChange={(e) => setDraft((x) => ({ ...x, notes: e.target.value || undefined }))} />
        </div>
        {/* H8: attach this subject's special courses so the deadline shows "N of M done". */}
        {courseLinks.length > 0 && (
          <div>
            <label className="small-label">Linked special courses ({linkSel.length} selected)</label>
            <div style={{ display: 'grid', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {courseLinks.map((c) => (
                <label key={c.id} className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={linkSel.includes(c.id)}
                    onChange={() =>
                      setLinkSel((sel) => (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]))
                    }
                  />
                  <span>{c.name} <span className="msg">· {c.status}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="msg">Reminder fires per your Settings lead time.</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary big-btn grow" onClick={onCancel}>Cancel</button>
          <button className="primary big-btn grow" disabled={!valid} onClick={() => valid && onSave(draft, courseLinks.length > 0 ? linkSel : undefined)}>Save</button>
        </div>
      </div>
    </div>
  )
}
