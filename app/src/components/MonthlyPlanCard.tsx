// MonthlyPlanCard — Section J Monthly attendance plan card (top of each subject page).
// Displays Classes, Must attend, Can skip, split gradient bar, friendly verdict line,
// and month switcher.

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { SubjectMonthPlan } from '../logic/projection'
import { projectSubjectMonth, planMonths } from '../logic/projection'
import { useApp } from '../data/store'
import { todayStr, monthKey } from '../logic/dates'
import { StatusPill } from './ui/parts'
import { subjectTileStyle, STATUS_VAR } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export default function MonthlyPlanCard({
  subjectId,
  selectedMonth,
  onMonthChange,
  onOpenSettings,
}: {
  subjectId: string
  selectedMonth?: string
  onMonthChange?: (m: string) => void
  onOpenSettings?: () => void
}) {
  const { data } = useApp()
  const { active } = useTheme()
  const today = todayStr()
  const curMonth = monthKey(today)
  const month = selectedMonth ?? curMonth

  const allMonths = useMemo(() => planMonths(data, today), [data, today])
  const plan: SubjectMonthPlan = useMemo(
    () => projectSubjectMonth(data, subjectId, month, today, { ignorePast: data.settings.ignorePastAttendance }),
    [data, subjectId, month, today],
  )

  const monthIdx = allMonths.indexOf(month)
  const canPrev = monthIdx > 0
  const canNext = monthIdx >= 0 && monthIdx < allMonths.length - 1

  const subjIdx = Math.max(0, data.subjects.findIndex((s) => s.id === subjectId))
  const tileStyle = subjectTileStyle(subjIdx, active)

  const [y, m] = month.split('-').map(Number)
  const monthTitle = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  // Progress percentages for the split bar
  const total = plan.classesInMonth
  const attendedPct = total > 0 ? (plan.presentInMonth / total) * 100 : 0
  const absentPct = total > 0 ? (plan.absentInMonth / total) * 100 : 0
  const remainingPct = total > 0 ? (plan.classesLeft / total) * 100 : 0

  return (
    <div
      className={`card monthly-plan-card ${plan.kind === 'projection' ? 'projection-card' : ''} ${plan.outOfReach ? 'out-of-reach-card' : ''}`}
      style={{
        ...tileStyle,
        borderRadius: 22,
        padding: '16px 18px',
        marginBottom: 16,
        border: plan.kind === 'projection' ? '2px dashed var(--soft)' : undefined,
      }}
    >
      {/* Month Navigator Header */}
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="icon-btn"
            disabled={!canPrev}
            onClick={() => canPrev && onMonthChange?.(allMonths[monthIdx - 1])}
            aria-label="Previous month"
            style={{ width: 34, height: 34 }}
          >
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{monthTitle}</span>
          <button
            className="icon-btn"
            disabled={!canNext}
            onClick={() => canNext && onMonthChange?.(allMonths[monthIdx + 1])}
            aria-label="Next month"
            style={{ width: 34, height: 34 }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="row" style={{ gap: 6 }}>
          {month !== curMonth && (
            <button
              className="chip"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => onMonthChange?.(curMonth)}
            >
              This month
            </button>
          )}
          {plan.kind === 'projection' && <StatusPill tone="neutral">Projection</StatusPill>}
          {plan.kind === 'finished' && <StatusPill tone="neutral">Finished</StatusPill>}
        </div>
      </div>

      {plan.classesInMonth === 0 && plan.priorHeld === 0 ? (
        <div className="msg" style={{ padding: '12px 0' }}>No classes this month.</div>
      ) : (
        <>
          {/* Three Big Figures */}
          <div
            className="row spread"
            style={{
              textAlign: 'center',
              margin: '8px 0 14px',
              padding: '6px 0',
            }}
          >
            <div style={{ flex: 1 }}>
              <div className="num" style={{ fontSize: 24, fontWeight: 800 }}>
                {plan.classesInMonth}
              </div>
              <div className="small-label" style={{ marginTop: 2 }}>Classes</div>
            </div>

            <div style={{ flex: 1, borderLeft: '1px solid color-mix(in srgb, var(--soft) 20%, transparent)', borderRight: '1px solid color-mix(in srgb, var(--soft) 20%, transparent)' }}>
              <div className="num" style={{ fontSize: 24, fontWeight: 800 }}>
                {plan.mustAttend}
              </div>
              <div className="small-label" style={{ marginTop: 2 }}>Must attend</div>
            </div>

            <div style={{ flex: 1.2 }}>
              <div
                className="num"
                style={{
                  fontSize: plan.outOfReach ? 18 : 28,
                  fontWeight: 900,
                  color: STATUS_VAR[plan.status],
                  lineHeight: plan.outOfReach ? '28px' : undefined,
                }}
              >
                {plan.outOfReach ? 'Out of reach' : plan.canSkip}
              </div>
              <div className="small-label" style={{ marginTop: 2 }}>
                {plan.outOfReach ? (plan.endPercent !== null ? `Max ${plan.endPercent.toFixed(1)}%` : 'Can skip') : 'Can skip'}
              </div>
            </div>
          </div>

          {/* Thick Rounded Split Gradient Bar */}
          {total > 0 && (
            <div
              style={{
                height: 10,
                borderRadius: 99,
                background: 'color-mix(in srgb, var(--soft) 20%, transparent)',
                display: 'flex',
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              {attendedPct > 0 && (
                <div
                  style={{
                    width: `${attendedPct}%`,
                    background: 'var(--safe)',
                    transition: 'width 0.4s ease',
                  }}
                  title={`Attended: ${plan.presentInMonth}`}
                />
              )}
              {absentPct > 0 && (
                <div
                  style={{
                    width: `${absentPct}%`,
                    background: 'var(--danger)',
                    transition: 'width 0.4s ease',
                  }}
                  title={`Absent: ${plan.absentInMonth}`}
                />
              )}
              {remainingPct > 0 && (
                <div
                  style={{
                    width: `${remainingPct}%`,
                    background: 'color-mix(in srgb, var(--soft) 40%, transparent)',
                    transition: 'width 0.4s ease',
                  }}
                  title={`Remaining: ${plan.classesLeft}`}
                />
              )}
            </div>
          )}

          {/* Friendly One-Line Verdict */}
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: STATUS_VAR[plan.status],
              marginTop: 4,
            }}
          >
            {plan.verdict}
          </div>
        </>
      )}

      {/* J13: Prompt to add semester end date if not set */}
      {!data.settings.semesterEnd && (
        <div className="row spread" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in srgb, var(--soft) 15%, transparent)' }}>
          <span className="msg" style={{ fontSize: 12 }}>Add semester end date to see all coming months.</span>
          {onOpenSettings && (
            <button className="chip" style={{ fontSize: 11 }} onClick={onOpenSettings}>
              Set in Settings
            </button>
          )}
        </div>
      )}
    </div>
  )
}

