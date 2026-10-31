// Step-2 app shell: ThemeProvider (design tokens, F9) wraps the data store;
// the floating pill navigation switches Today / Calendar / Subjects / Settings.

import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './data/store'
import { ThemeProvider } from './theme/ThemeProvider'
import NavBar from './components/NavBar'
import type { Tab } from './components/NavBar'
import Today from './components/Today'
import Calendar from './components/Calendar'
import Subjects from './components/Subjects'
import Timetable from './components/Timetable'
import Study from './components/Study'
import Settings from './components/Settings'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { runCatchUpReminders, ensureNotifyPermission, eveningNudgeDue, fireEveningNudgeAsync } from './logic/reminders'
import { todayStr } from './logic/dates'

/** D6/B11: on app open — request permission, fire any deadline reminders that
 *  came due while closed, and show the evening "mark attendance" nudge. */
function ReminderRunner() {
  const { data } = useApp()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureNotifyPermission()
      if (cancelled) return
      runCatchUpReminders(data)
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (eveningNudgeDue(data, todayStr(), hhmm)) {
        void fireEveningNudgeAsync('Mark your attendance', "Today's classes aren't all marked yet.")
      }
    })()
    return () => {
      cancelled = true
    }
    // Run once per mount; data read is a snapshot at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/** Native polish: on Android the WebView draws under the status bar, so we
 *  tint it to match the current theme's header colour (and use light icons
 *  in Midnight). No-op on web. Re-runs whenever data-theme changes. */
function StatusBarTint() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const sync = () => {
      const dark = document.documentElement.dataset.theme === 'midnight'
      void StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }).catch(() => {})
      void StatusBar.setBackgroundColor({ color: dark ? '#3A1458' : '#7B1E3A' }).catch(() => {})
    }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return null
}

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [focusSubjectId, setFocusSubjectId] = useState<string | null>(null)
  // Navigation with optional subject deep-link (Today/Subjects → plan details).
  // 'plan' is a legacy deep-link tab: it opens Subjects focused on that subject.
  const go = (t: Tab, subjectId?: string) => {
    setFocusSubjectId(subjectId ?? null)
    setTab(t === 'plan' ? 'subjects' : t)
  }
  return (
    <ThemeProvider>
      <AppProvider>
        <ReminderRunner />
        <StatusBarTint />
        {tab === 'today' && <Today go={go} />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'timetable' && <TimetableView />}
        {tab === 'study' && <Study />}
        {(tab === 'subjects' || tab === 'plan') && <Subjects go={go} focusSubjectId={focusSubjectId} />}
        {tab === 'settings' && <Settings />}
        <NavBar tab={tab} onChange={(t) => go(t)} />
      </AppProvider>
    </ThemeProvider>
  )
}

/** The Timetable tab: the editor grid that used to live behind a chip inside
 *  the Subjects screen. */
function TimetableView() {
  return (
    <div className="screen pad">
      <h1 style={{ margin: '0 0 8px' }}>Timetable</h1>
      <Timetable />
    </div>
  )
}
