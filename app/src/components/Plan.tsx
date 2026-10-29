// ============================================================
// Plan screen — Monthly Plan (Section J).
// Month navigation and per-subject MonthlyPlanCard components.
// Strict compliance with J1: "Per subject only; no overall total".
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../data/store'
import { planMonths } from '../logic/projection'
import { todayStr, monthKey } from '../logic/dates'
import { SectionTitle, ChipRow } from './ui/parts'
import MonthlyPlanCard from './MonthlyPlanCard'

function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

export default function Plan({ focusSubjectId }: { focusSubjectId?: string | null } = {}) {
  const { data } = useApp()
  const today = todayStr()
  const months = useMemo(() => planMonths(data, today), [data, today])
  const curMonthKey = monthKey(today)
  const [selMonth, setSelMonth] = useState<string>(
    months.includes(curMonthKey) ? curMonthKey : months[0] ?? curMonthKey,
  )
  const [selSubj, setSelSubj] = useState<string>(focusSubjectId ?? 'all')

  useEffect(() => {
    if (focusSubjectId) setSelSubj(focusSubjectId)
  }, [focusSubjectId])

  const idx = months.indexOf(selMonth)

  const subjectsToShow = useMemo(() => {
    if (selSubj === 'all') return data.subjects
    return data.subjects.filter((s) => s.id === selSubj)
  }, [data.subjects, selSubj])

  const filterOptions = useMemo(() => {
    return [
      { id: 'all', label: 'All subjects' },
      ...data.subjects.map((s) => ({ id: s.id, label: s.shortName })),
    ]
  }, [data.subjects])

  return (
    <div className="screen pad">
      <SectionTitle>MONTHLY PLAN</SectionTitle>

      {/* Month Switcher Header */}
      <div className="plan-month-nav">
        <button
          className="card-like plan-arrow"
          aria-label="Previous month"
          disabled={idx <= 0}
          onClick={() => idx > 0 && setSelMonth(months[idx - 1])}
        >
          <ChevronLeft size={18} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div className="plan-month-label">{fmtMonth(selMonth)}</div>
          {selMonth !== curMonthKey && (
            <button
              className="link-btn"
              style={{ fontSize: 12, marginTop: 2 }}
              onClick={() => setSelMonth(curMonthKey)}
            >
              Back to this month
            </button>
          )}
        </div>

        <button
          className="card-like plan-arrow"
          aria-label="Next month"
          disabled={idx >= months.length - 1}
          onClick={() => idx < months.length - 1 && setSelMonth(months[idx + 1])}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {data.subjects.length > 1 && (
        <ChipRow
          options={filterOptions}
          value={selSubj}
          onChange={setSelSubj}
        />
      )}

      {/* Section J: Per subject only; no overall total */}
      {subjectsToShow.length === 0 ? (
        <div className="card empty-card" style={{ marginTop: 12 }}>
          No subjects found. Add your timetable under Subjects to see your monthly attendance plan.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {subjectsToShow.map((s) => (
            <MonthlyPlanCard
              key={s.id}
              subjectId={s.id}
              selectedMonth={selMonth}
              onMonthChange={setSelMonth}
            />
          ))}
        </div>
      )}
    </div>
  )
}
