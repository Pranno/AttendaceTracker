// Step-2 app shell: ThemeProvider (design tokens, F9) wraps the data store;
// the floating pill navigation switches Today / Calendar / Subjects / Settings.

import { useEffect, useState, useRef } from 'react'
import { AppProvider, useApp } from './data/store'
import { ThemeProvider } from './theme/ThemeProvider'
import NavBar from './components/NavBar'
import type { Tab } from './components/NavBar'
import { useTabSwipe } from './hooks/useTabSwipe'
import Today from './components/Today'
import Calendar from './components/Calendar'
import Subjects from './components/Subjects'
import Timetable from './components/Timetable'
import Locker from './components/Locker'
import Settings from './components/Settings'
import Onboarding from './components/Onboarding'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { autoCheckEmail } from './logic/emailCheck'
import { syncBackgroundEmailCheck } from './logic/gmailNative'
import { runCatchUpReminders, ensureNotifyPermission, eveningNudgeDue, fireEveningNudgeAsync, syncDailyNotifications } from './logic/reminders'
import { todayStr } from './logic/dates'

/** D6/B11: on app open — wait for the user to finish the first-launch tour
 *  before asking for notification permission (Android shows at most one
 *  permission prompt per call, so it must not compete with the wizard), then
 *  fire any deadline reminders that came due while closed and show the evening
 *  "mark attendance" nudge. */
function ReminderRunner() {
  const { data } = useApp()
  const onboarded = data.settings.onboarded
  useEffect(() => {
    if (!onboarded) return // ask only after the wizard is dismissed
    let cancelled = false
    void (async () => {
      await ensureNotifyPermission()
      if (cancelled) return
      runCatchUpReminders(data)
      // Native: arm the two recurring daily notifications (9 PM nudge + next-day
      // class preview) with the OS scheduler so they fire even when the app is
      // closed — same mechanism as the deadline reminders. Web relies on the
      // open-app checks below.
      await syncDailyNotifications(data)
      if (cancelled) return
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      // Native builds get the nudge from the OS schedule armed just above;
      // firing here as well doubled it. On web, show it at most once a day
      // (it used to pop on every app open after the evening time).
      const nudgeKey = `attendancetracker.eveningNudge.${todayStr()}`
      let shownToday = false
      try {
        shownToday = localStorage.getItem(nudgeKey) === '1'
      } catch {
        /* storage unavailable */
      }
      if (!Capacitor.isNativePlatform() && !shownToday && eveningNudgeDue(data, todayStr(), hhmm)) {
        try {
          localStorage.setItem(nudgeKey, '1')
        } catch {
          /* ignore */
        }
        void fireEveningNudgeAsync('Mark your attendance', "Today's classes aren't all marked yet.")
      }
    })()
    return () => {
      cancelled = true
    }
    // Run once when the tour ends; data read is a snapshot at that time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded])
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
  // True while the first-launch wizard covers the screen (set by OnboardingShell).
  const [showOnboarding, setShowOnboarding] = useState(false)
  // Navigation with optional subject deep-link (Today/Subjects → plan details).
  // 'plan' is a legacy deep-link tab: it opens Subjects focused on that subject.
  const go = (t: Tab, subjectId?: string) => {
    setFocusSubjectId(subjectId ?? null)
    setTab(t === 'plan' ? 'subjects' : t)
  }

  // Native-style swipe between tabs (swipe left → next tab, right → previous).
  // The hook ignores vertical scrolling, horizontally-scrollable strips (like
  // the weekday bar), and taps on buttons/inputs — see hooks/useTabSwipe.ts.
  const TAB_ORDER: Tab[] = ['today', 'subjects', 'timetable', 'calendar', 'locker', 'settings']
  useTabSwipe((dir) => {
    if (showOnboarding) return // the wizard owns the screen — no tab swipes
    setTab((cur) => {
      const i = TAB_ORDER.indexOf(cur === 'plan' ? 'subjects' : cur)
      const next = TAB_ORDER[i + dir]
      return next ?? cur // no wrap-around at the ends
    })
    setFocusSubjectId(null)
  })

  // First-launch onboarding tour. The flag lives in settings.onboarded, so it
  // is decided inside AppProvider; OnboardingShell reads it and hides itself
  // once finished. Finishing lands the user on Settings (semester dates first).
  return (
    <ThemeProvider>
      <AppProvider>
        <ReminderRunner />
        <StatusBarTint />
        <EmailAutoChecker />
        <OnboardingShell go={go} onShownChange={setShowOnboarding} />
        {tab === 'today' && <Today go={go} />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'timetable' && <TimetableView />}
        {tab === 'locker' && <Locker />}
        {(tab === 'subjects' || tab === 'plan') && <Subjects go={go} focusSubjectId={focusSubjectId} />}
        {tab === 'settings' && <Settings />}
        <NavBar tab={tab} onChange={(t) => go(t)} />
      </AppProvider>
    </ThemeProvider>
  )
}

/** New deadlines in Gmail (if connected): checked when the app starts and
 *  every time it comes back to the front, at most every 3 hours. Important
 *  ones are added automatically; the rest become suggestions. */
function EmailAutoChecker() {
  const app = useApp()
  const latest = useRef(app)
  latest.current = app
  useEffect(() => {
    const run = () => {
      const a = latest.current
      if (!a.data.settings.onboarded) return
      void autoCheckEmail(a.data, { addSuggestions: a.addSuggestions, addDeadline: a.addDeadline, updateSuggestions: (patch) => a.setData((d) => ({ ...d, suggestions: d.suggestions.map((x) => (patch.has(x.id) ? { ...x, ...patch.get(x.id) } : x)) })) })
      void syncBackgroundEmailCheck(a.data.settings)
    }
    run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  return null
}

/** First-launch wizard host: reads settings.onboarded (inside AppProvider) and
 *  covers the app with the tour until it is finished or skipped. */
function OnboardingShell({
  go,
  onShownChange,
}: {
  go: (t: Tab) => void
  onShownChange: (shown: boolean) => void
}) {
  const { data } = useApp()
  const show = !data.settings.onboarded
  useEffect(() => onShownChange(show), [show, onShownChange])
  if (!show) return null
  return (
    <Onboarding
      key="onb" // fresh state each time it mounts
      onDone={(goTo) => {
        go(goTo) // the setup steps already saved semester, batch and rules
      }}
    />
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
