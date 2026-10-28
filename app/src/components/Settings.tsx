// Settings tab — step 1: the threshold (F1), semester dates (F5), assumed past
// attendance (F10), Sunday classes (A13), ERP totals per subject (B8), delete all data (F8).
// The theme picker, reminder times and export polish land in Step 2.

import { useState } from 'react'
import { useApp } from '../data/store'
import { exportData } from '../data/storage'

export default function Settings() {
  const { data, updateSettings, setData, resetAll } = useApp()
  const s = data.settings
  const [confirmDelete, setConfirmDelete] = useState(false)

  function setTypedTotals(subjectId: string, attended: string, held: string) {
    setData((d) => ({
      ...d,
      subjects: d.subjects.map((sub) => {
        if (sub.id !== subjectId) return sub
        const next = { ...sub }
        if (held.trim() === '') {
          delete next.typedHeld
          delete next.typedAttended
        } else {
          next.typedHeld = Math.max(0, Number(held) || 0)
          next.typedAttended = Math.max(0, Number(attended) || 0)
        }
        return next
      }),
    }))
  }

  return (
    <div>
      <h1>Settings</h1>

      <div className="card">
        <label>Minimum attendance to keep (%)</label>
        <div className="row">
          <input
            type="range"
            min={1}
            max={100}
            value={s.threshold}
            onChange={(e) => updateSettings({ threshold: Number(e.target.value) })}
            className="grow"
          />
          <b style={{ fontSize: 22, minWidth: 56, textAlign: 'right' }}>{s.threshold}%</b>
        </div>
        <div className="msg">Every warning and “can skip” number uses this.</div>
      </div>

      <div className="card">
        <label>Assumed attendance for past unmarked classes (%)</label>
        <div className="row">
          <input
            type="range"
            min={0}
            max={100}
            value={s.assumedPastAttendance}
            onChange={(e) => updateSettings({ assumedPastAttendance: Number(e.target.value) })}
            className="grow"
          />
          <b style={{ fontSize: 22, minWidth: 56, textAlign: 'right' }}>
            {s.assumedPastAttendance}%
          </b>
        </div>
        <div className="msg">Used until you mark a day or type real ERP totals below.</div>
      </div>

      <div className="card">
        <label>Semester name</label>
        <input
          value={s.semesterName}
          onChange={(e) => updateSettings({ semesterName: e.target.value })}
          placeholder="Semester 1"
        />
        <div className="row">
          <div className="grow">
            <label>Semester start</label>
            <input
              type="date"
              value={s.semesterStart ?? ''}
              onChange={(e) => updateSettings({ semesterStart: e.target.value || null })}
            />
          </div>
          <div className="grow">
            <label>Tentative end</label>
            <input
              type="date"
              value={s.semesterEnd ?? ''}
              onChange={(e) => updateSettings({ semesterEnd: e.target.value || null })}
            />
          </div>
        </div>
        <div className="msg">Classes only appear inside this range; the monthly plan needs both.</div>
      </div>

      <div className="card row spread">
        <div>
          <b>Sunday classes</b>
          <div className="msg">Sunday is off by default.</div>
        </div>
        <input
          type="checkbox"
          checked={s.sundayClasses}
          onChange={(e) => updateSettings({ sundayClasses: e.target.checked })}
        />
      </div>

      <h2>Real totals from the college ERP (per subject)</h2>
      <div className="msg" style={{ marginBottom: 8 }}>
        Typing totals here replaces the app’s calculated/assumed figures for that subject.
      </div>
      {data.subjects.map((sub) => (
        <div className="card" key={sub.id}>
          <b>{sub.shortName}</b>
          <div className="row" style={{ marginTop: 6 }}>
            <div className="grow">
              <label>Attended</label>
              <input
                type="number"
                min={0}
                value={sub.typedAttended ?? ''}
                onChange={(e) => setTypedTotals(sub.id, e.target.value, sub.typedHeld?.toString() ?? '')}
              />
            </div>
            <div className="grow">
              <label>Held</label>
              <input
                type="number"
                min={0}
                value={sub.typedHeld ?? ''}
                onChange={(e) => setTypedTotals(sub.id, sub.typedAttended?.toString() ?? '', e.target.value)}
              />
            </div>
            {(sub.typedHeld !== undefined || sub.typedAttended !== undefined) && (
              <button onClick={() => setTypedTotals(sub.id, '', '')}>Clear</button>
            )}
          </div>
        </div>
      ))}

      <h2>Your data</h2>
      <div className="card row">
        <button onClick={() => exportData(data)}>Export my data</button>
        {confirmDelete ? (
          <button
            className="absent on"
            onClick={() => {
              resetAll()
              setConfirmDelete(false)
            }}
          >
            Tap again to confirm delete-all
          </button>
        ) : (
          <button onClick={() => setConfirmDelete(true)}>Delete all my data</button>
        )}
      </div>
    </div>
  )
}
