// ============================================================
// Today screen — Step 2 design (section "Screen designs → Today").
// Gradient header (edge to edge), greeting + date, theme button,
// shortcut tiles, paste-pill bar (opens PasteDeadlineSheet),
// overlapping attendance hero card with the big ring,
// THIS MONTH rows (Section J figures), today's class cards with
// B1 choice collapse & Change link, coming-up deadline cards and
// a vivid "revise next" banner.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Moon, SunMedium, BookOpenCheck } from 'lucide-react'
import { useApp } from '../data/store'
import type { DateStr, MarkStatus } from '../data/model'
import { buildReport, slotsForDate, isHoliday, markFor } from '../logic/attendance'
import { addDays, diffDays, formatShort, monthKey, todayStr, weekdayName, weekdayOf } from '../logic/dates'
import { PercentRing, SectionTitle, StatusPill, ChipRow } from './ui/parts'
import { subjectPalette, subjectTileStyle, STATUS_VAR } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import type { Tab } from './NavBar'
import { projectSubjectMonth } from '../logic/projection'
import PasteDeadlineSheet from './PasteDeadlineSheet'

export default function Today({ go }: { go: (t: Tab, subjectId?: string) => void }) {
  const { data, setMark } = useApp()
  const { active, choice, setChoice } = useTheme()
  const [undoMsg, setUndoMsg] = useState<string | null>(null)
  const [dateOverride, setDateOverride] = useState<DateStr | null>(null)
  const [filter, setFilter] = useState<'all' | 'unmarked' | 'below'>('all')
  const undoRef = useRef<(() => void) | null>(null)
  const [popSlot, setPopSlot] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)

  const today = todayStr()
  const viewDate = dateOverride ?? today
  const isPast = viewDate < today

  const rangeStart = useMemo<DateStr>(() => {
    if (data.settings.semesterStart) return data.settings.semesterStart
    if (data.slots.length === 0) return today
    return data.slots.reduce((min, s) => (s.validFrom < min ? s.validFrom : min), today)
  }, [data.settings.semesterStart, data.slots, today])

  const report = useMemo(
    () => buildReport(data, today, rangeStart, today),
    [data, today, rangeStart],
  )

  const holiday = isHoliday(data, viewDate)
  const daySlots = useMemo(() => {
    if (holiday) return []
    return slotsForDate(data, viewDate).sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [data, viewDate, holiday])

  // Overall status for the hero ring colour (J10 tones).
  const overallTone: 'safe' | 'limit' | 'below' | 'nodata' =
    report.bySubject.every((s) => s.held === 0)
      ? 'nodata'
      : report.overall >= data.settings.threshold + 5
        ? 'safe'
        : report.overall >= data.settings.threshold
          ? 'limit'
          : 'below'

  const totalCanSkip = report.bySubject.reduce((a, s) => a + s.canMiss, 0)
  const heroLine =
    overallTone === 'nodata'
      ? 'Add your timetable to start tracking.'
      : overallTone === 'safe'
        ? `You're safe! You can skip ${totalCanSkip} more ${totalCanSkip === 1 ? 'class' : 'classes'}`
        : overallTone === 'limit'
          ? "At the limit. Don't miss the next class"
          : `Below ${data.settings.threshold}% — attend the next classes to get back on track`

  // This-month rows per subject: Section J numbers (Classes, Must attend, Can skip)
  const curMonthKey = monthKey(today)
  const monthRows = useMemo(() => {
    return report.bySubject.map((s, i) => {
      const plan = projectSubjectMonth(data, s.subjectId, curMonthKey, today)
      return { summary: s, index: i, plan }
    })
  }, [report, data, curMonthKey, today])

  // Coming-up deadlines (next 3 weeks).
  const upcoming = useMemo(
    () =>
      data.deadlines
        .filter((dl) => !dl.done && dl.dueDate >= today && diffDays(today, dl.dueDate) <= 21)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 6),
    [data.deadlines, today],
  )

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  function mark(slotId: string, status: MarkStatus | null) {
    const prev = markFor(data, viewDate, slotId)
    setMark(viewDate, slotId, status)
    setPopSlot(slotId)
    setTimeout(() => setPopSlot(null), 450)
    if (status !== null) {
      undoRef.current = () => setMark(viewDate, slotId, prev)
      setUndoMsg(`Marked ${status === 'noclass' ? 'No class' : status === 'cancelled' ? 'Cancelled' : status}.`)
      window.setTimeout(() => setUndoMsg(null), 4000)
      // Light haptic feedback where supported.
      navigator.vibrate?.(10)
    }
  }

  const shownSlots = daySlots.filter((slot) => {
    if (filter === 'all') return true
    const status = markFor(data, viewDate, slot.id)
    if (filter === 'unmarked') return status === null
    // 'below': only subjects under threshold
    const rep = report.bySubject.find((r) => r.subjectId === slot.subjectId)
    return rep ? rep.status === 'below' || rep.status === 'limit' : true
  })

  const subjectIndex = (id: string) => Math.max(0, data.subjects.findIndex((s) => s.id === id))

  return (
    <div className="screen">
      {/* ---------- gradient header, edge to edge ---------- */}
      <header className="hero-header">
        <div className="header-blob" aria-hidden />
        <div className="row spread header-top">
          <div>
            <div className="greeting">{greeting},</div>
            <div className="header-date num">
              {weekdayName(weekdayOf(viewDate))}, {formatShort(viewDate, true)}
            </div>
          </div>
          <button
            className="icon-btn light"
            onClick={() => setChoice(active === 'sunrise' ? 'midnight' : 'sunrise')}
            aria-label="Toggle theme"
          >
            {active === 'sunrise' ? <Moon size={20} /> : <SunMedium size={20} />}
          </button>
        </div>

        {/* shortcut tiles */}
        <div className="row shortcuts">
          <button className="shortcut" onClick={() => go('calendar')}>
            <span className="shortcut-ico" style={{ background: subjectPalette(3).softBg, color: subjectPalette(3).strong }}>🗓️</span>
            Calendar
          </button>
          <button className="shortcut" onClick={() => go('subjects')}>
            <span className="shortcut-ico" style={{ background: subjectPalette(2).softBg, color: subjectPalette(2).strong }}>📚</span>
            Subjects
          </button>
          <button className="shortcut" onClick={() => go('calendar')}>
            <span className="shortcut-ico" style={{ background: subjectPalette(5).softBg, color: subjectPalette(5).strong }}>⏰</span>
            Deadlines
          </button>
        </div>

        {/* paste pill bar (D1: opens paste modal) */}
        <button className="paste-pill" onClick={() => setPasteOpen(true)}>
          <ClipboardPaste size={18} />
          <span>Paste a college message…</span>
        </button>

        {/* hero card overlapping the header */}
        <div className="hero-card card">
          <PercentRing
            percent={report.overall}
            color={`var(--${overallTone === 'below' ? 'danger' : overallTone === 'limit' ? 'limit' : overallTone === 'safe' ? 'safe' : 'soft'})`}
            label={`target ${data.settings.threshold}%`}
          />
          <div className="grow">
            <div className="hero-line"><b>{heroLine}</b></div>
            <div className="msg">
              {report.warnings.length > 0
                ? `Below target: ${report.warnings.map((w) => w.shortName).join(', ')}`
                : 'All subjects at or above your minimum.'}
            </div>
          </div>
        </div>
      </header>

      {choice === 'system' && null /* follow-the-phone handled by provider */}

      {/* ---------- day strip ---------- */}
      <div className="row daystrip">
        <button className="icon-btn" onClick={() => setDateOverride(addDays(viewDate, -1))} aria-label="Previous day">◀</button>
        <div className="grow" style={{ textAlign: 'center' }}>
          <b>{viewDate === today ? 'Today' : formatShort(viewDate)}</b>
          <div className="small-label">{isPast ? 'past day · marks editable' : 'upcoming'}</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => setDateOverride(addDays(viewDate, 1) > today ? today : addDays(viewDate, 1))}
          aria-label="Next day"
        >
          ▶
        </button>
        {dateOverride && <button className="chip" onClick={() => setDateOverride(null)}>Back to today</button>}
      </div>

      {undoMsg && (
        <div className="card undo-card row spread">
          <span className="msg">{undoMsg}</span>
          <button
            className="primary"
            onClick={() => {
              undoRef.current?.()
              setUndoMsg(null)
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ---------- this month (Section J) ---------- */}
      <SectionTitle>THIS MONTH · {new Date().toLocaleString('en', { month: 'long' })}</SectionTitle>
      {monthRows.length === 0 && (
        <div className="card msg">No subjects yet — add your timetable under Subjects.</div>
      )}
      {monthRows.map(({ summary: s, index, plan }) => (
        <button
          key={s.subjectId}
          className="month-row card-like"
          style={subjectTileStyle(index, active)}
          onClick={() => go('subjects', s.subjectId)}
        >
          <span className="subj-dot" style={{ background: 'var(--subj-strong)', color: 'var(--subj-on)' }}>
            {s.shortName.slice(0, 2)}
          </span>
          <span className="grow" style={{ textAlign: 'left' }}>
            <b>{s.shortName}</b>
            <span className="msg month-row-verdict" style={{ display: 'block', fontSize: 12 }}>
              {plan.verdict}
            </span>
          </span>
          {/* Three pill figures: classes, must attend, can skip (Section J / Screen designs) */}
          <StatusPill tone="neutral">{plan.classesInMonth} classes</StatusPill>
          <StatusPill tone="neutral">{plan.mustAttend} to attend</StatusPill>
          <StatusPill
            tone={plan.status === 'safe' ? 'safe' : plan.status === 'limit' ? 'limit' : plan.status === 'below' ? 'below' : 'neutral'}
          >
            {plan.outOfReach ? 'Out of reach' : `skip ${plan.canSkip}`}
          </StatusPill>
        </button>
      ))}

      {/* ---------- today's classes (B1: Present / Absent / No class) ---------- */}
      <SectionTitle>CLASSES · {formatShort(viewDate)}</SectionTitle>
      <ChipRow
        options={[
          { id: 'all', label: 'All' },
          { id: 'unmarked', label: 'Not marked yet' },
          { id: 'below', label: 'At risk' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {holiday && (
        <div className="card empty-card">
          🎉 <b>Holiday.</b>{' '}
          <span className="msg">
            {data.holidays.find((h) => !h.isExamDay && viewDate >= h.startDate && viewDate <= h.endDate)?.label ?? 'No class today.'}
          </span>
        </div>
      )}
      {!holiday && shownSlots.length === 0 && (
        <div className="card empty-card">No classes on {formatShort(viewDate)}. Enjoy!</div>
      )}

      {!holiday &&
        shownSlots.map((slot) => {
          const subj = data.subjects.find((s) => s.id === slot.subjectId)
          const status = markFor(data, viewDate, slot.id)
          const idx = subjectIndex(slot.subjectId)
          return (
            <div
              className={`class-card card-like ${popSlot === slot.id ? 'pop' : ''}`}
              key={slot.id}
              style={subjectTileStyle(idx, active)}
            >
              <div className="row spread">
                <div>
                  <b style={{ color: 'var(--subj-strong)' }}>{subj?.shortName}</b>
                  <div className="class-meta">
                    {slot.startTime}–{slot.endTime} · {slot.type}
                    {slot.room ? ` · ${slot.room}` : ''}
                  </div>
                </div>
                {status && (
                  <span className="tick" style={{ background: 'var(--subj-strong)', color: 'var(--subj-on)' }} aria-hidden>
                    ✓
                  </span>
                )}
              </div>

              {/* B1: A marked class shows only its choice, with a Change link to switch */}
              {status ? (
                <div className="row mark-row spread" style={{ marginTop: 8 }}>
                  <span className={`status-chip ${status}`}>
                    {status === 'cancelled' ? 'Cancelled' : status === 'noclass' ? 'No class' : status === 'present' ? 'Present' : 'Absent'}
                  </span>
                  <button className="link-btn" onClick={() => mark(slot.id, null)}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="row mark-row">
                  <button className="mark present" onClick={() => mark(slot.id, 'present')}>
                    Present
                  </button>
                  <button className="mark absent" onClick={() => mark(slot.id, 'absent')}>
                    Absent
                  </button>
                  <button className="mark noclass" onClick={() => mark(slot.id, 'noclass')}>
                    No class
                  </button>
                </div>
              )}
            </div>
          )
        })}

      {/* ---------- coming up ---------- */}
      {upcoming.length > 0 && (
        <>
          <SectionTitle>COMING UP</SectionTitle>
          <div className="hscroll">
            {upcoming.map((dl) => {
              const idx = dl.subjectId ? subjectIndex(dl.subjectId) : 0
              const pal = subjectPalette(idx)
              const daysLeft = diffDays(today, dl.dueDate)
              const dark = active === 'midnight'
              return (
                <div
                  className="deadline-card card-like"
                  key={dl.id}
                  style={dark ? { background: `color-mix(in srgb, ${pal.strong} 25%, #2A1E3A)` } : { background: pal.softBg }}
                >
                  <span className="deal-tag" style={{ background: pal.strong }}>
                    {daysLeft === 0 ? 'today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                  </span>
                  <b>{dl.title}</b>
                  <div className="class-meta">{formatShort(dl.dueDate)}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ---------- revise next banner ---------- */}
      <div className="banner card-like">
        <BookOpenCheck size={30} />
        <div className="grow">
          <b>Revise next</b>
          <div className="banner-sub">Study progress arrives in Step 6 — until then, plan your own revision.</div>
        </div>
        <button className="pill-btn light" onClick={() => go('subjects')}>
          Open
        </button>
      </div>

      {/* ---------- subject percentages ---------- */}
      <SectionTitle>SUBJECTS</SectionTitle>
      {report.bySubject.map((s, i) => (
        <div className="card subject-card" key={s.subjectId} style={{ borderLeft: `6px solid ${STATUS_VAR[s.status]}` }}>
          <div className="row spread">
            <div>
              <b style={{ color: subjectPalette(i).strong }}>{s.shortName}</b>{' '}
              <span className="msg">
                {s.name} · {s.attended}/{s.held}
              </span>
            </div>
            <div className="num pct" style={{ color: STATUS_VAR[s.status] }}>
              {s.held === 0 ? '—' : `${s.percent.toFixed(1)}%`}
            </div>
          </div>
          <div className="msg">{s.message}</div>
        </div>
      ))}

      {/* Paste Deadline Sheet (D1) */}
      <PasteDeadlineSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  )
}
