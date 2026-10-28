// ============================================================
// Plan screen — Monthly Plan (section J).
// Month navigation, per-subject projection cards (live %, breach
// date, skip headroom, recovery count) and a weekly summary table.
// All numbers come from logic/projection.ts — no simplified math.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../data/store'
import { buildMonthPlan, planMonths, planVerdict } from '../logic/projection'
import { todayStr, monthKey, formatShort } from '../logic/dates'
import { SectionTitle, StatusPill } from './ui/parts'
import { subjectPalette, STATUS_VAR } from '../theme/tokens'

function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

export default function Plan({ focusSubjectId }: { focusSubjectId?: string | null } = {}) {
  const { data } = useApp()
  const today = todayStr()
  const months = useMemo(() => planMonths(data, today), [data, today])
  const [sel, setSel] = useState<string>(months.includes(monthKey(today)) ? monthKey(today) : months[0] ?? monthKey(today))
  // J1-style deep link: pre-open one subject's projection card.
  const [openId, setOpenId] = useState<string | null>(focusSubjectId ?? null)
  useEffect(() => {
    setOpenId(focusSubjectId ?? null)
  }, [focusSubjectId])

  const plan = useMemo(() => buildMonthPlan(data, sel, today), [data, sel, today])
  const idx = months.indexOf(sel)

  return (
    <div className="screen">
      <SectionTitle>Monthly plan</SectionTitle>

      <div className="plan-month-nav">
        <button
          className="card-like plan-arrow"
          aria-label="Previous month"
          disabled={idx <= 0}
          onClick={() => idx > 0 && setSel(months[idx - 1])}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="plan-month-label">{fmtMonth(sel)}</div>
        <button
          className="card-like plan-arrow"
          aria-label="Next month"
          disabled={idx >= months.length - 1}
          onClick={() => idx < months.length - 1 && setSel(months[idx + 1])}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Overall */}
      <div className="card plan-overall">
        <div className="plan-overall-pct" style={{ color: STATUS_VAR[plan.overallPercent >= data.settings.threshold ? 'safe' : plan.overallPercent >= data.settings.threshold - 5 ? 'limit' : 'below'] }}>
          {plan.overallHeld === 0 ? '—' : `${Math.round(plan.overallPercent)}%`}
        </div>
        <div className="msg">
          {plan.overallHeld === 0
            ? 'No classes counted in this window yet.'
            : `${plan.overallAttended}/${plan.overallHeld} attended overall · threshold ${data.settings.threshold}%`}
        </div>
      </div>

      {/* Subject cards */}
      {plan.subjects.map((sp, i) => {
        const p = subjectPalette(i)
        const statusColor = sp.status === 'nodata' ? STATUS_VAR.nodata : STATUS_VAR[sp.status]
        const expanded = openId === null || openId === sp.subjectId
        return (
          <div
            key={sp.subjectId}
            className={`card plan-card${openId === sp.subjectId ? ' plan-card-focus' : ''}`}
            style={{ borderTop: `3px solid ${p.strong}` }}
            onClick={() => setOpenId(openId === sp.subjectId ? null : sp.subjectId)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setOpenId(openId === sp.subjectId ? null : sp.subjectId)}
          >
            <div className="plan-card-head">
              <div className="grow">
                <div className="plan-card-name">{sp.shortName}</div>
                <div className="msg plan-card-full">{sp.name}</div>
              </div>
              <div className="plan-card-right">
                <div className="plan-card-pct" style={{ color: statusColor }}>
                  {sp.current.held === 0 ? '—' : `${Math.round(sp.currentPercent)}%`}
                </div>
                <StatusPill tone={sp.status === 'nodata' ? 'neutral' : sp.status}>
                  {sp.status === 'nodata' ? 'no data' : sp.status}
                </StatusPill>
              </div>
            </div>

            {/* J8/J9 one-line verdict */}
            <div className={`plan-verdict plan-verdict-${sp.status}`}>{planVerdict(sp)}</div>

            <div className="plan-rows" hidden={!expanded}>
              {sp.status !== 'nodata' && (
                <div className="plan-row">
                  <span className="plan-k">Current</span>
                  <span className="plan-v">{sp.current.attended}/{sp.current.held} held{sp.usesTypedTotals ? ' (typed totals)' : ''}</span>
                </div>
              )}
              {sp.breachDate && (
                <div className="plan-row danger">
                  <span className="plan-k">Breach if all skipped</span>
                  <span className="plan-v">falls below {sp.threshold}% on {formatShort(sp.breachDate)}</span>
                </div>
              )}
              {sp.safeUntil && (
                <div className="plan-row safe">
                  <span className="plan-k">Safe to skip through</span>
                  <span className="plan-v">{formatShort(sp.safeUntil)}</span>
                </div>
              )}
              {sp.status !== 'nodata' && (
                <div className="plan-row">
                  <span className="plan-k">Can still skip</span>
                  <span className="plan-v">{sp.canSkipRest} of {sp.remainingClasses} remaining class{sp.remainingClasses === 1 ? '' : 'es'}</span>
                </div>
              )}
              {sp.mustAttendNext > 0 && (
                <div className="plan-row warn">
                  <span className="plan-k">To recover</span>
                  <span className="plan-v">attend next {sp.mustAttendNext} straight class{sp.mustAttendNext === 1 ? '' : 'es'}</span>
                </div>
              )}
              {sp.status === 'nodata' && (
                <div className="msg">No classes recorded for this subject yet.</div>
              )}
            </div>
          </div>
        )
      })}

      {/* Weekly summary */}
      {plan.weekly.length > 0 && (
        <>
          <SectionTitle>Week by week</SectionTitle>
          <div className="card plan-week-table">
            <div className="plan-wrow plan-whead">
              <span>Week of</span><span>Held</span><span>Attended</span><span>%</span>
            </div>
            {plan.weekly.map((w) => (
              <div key={w.weekStart} className="plan-wrow">
                <span>{formatShort(w.weekStart)}</span>
                <span>{w.held}</span>
                <span>{w.attended}</span>
                <span style={{ color: w.held === 0 ? STATUS_VAR.nodata : STATUS_VAR[w.percent >= data.settings.threshold ? 'safe' : w.percent >= data.settings.threshold - 5 ? 'limit' : 'below'] }}>
                  {w.held === 0 ? '—' : Math.round(w.percent) + '%'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {months.length === 0 && <div className="msg">Set a semester end date in Settings to see future months.</div>}
    </div>
  )
}
