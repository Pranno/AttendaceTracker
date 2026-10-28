// Step-2 app shell: ThemeProvider (design tokens, F9) wraps the data store;
// the floating pill navigation switches Today / Calendar / Subjects / Settings.

import { useState } from 'react'
import { AppProvider } from './data/store'
import { ThemeProvider } from './theme/ThemeProvider'
import NavBar from './components/NavBar'
import type { Tab } from './components/NavBar'
import Today from './components/Today'
import Calendar from './components/Calendar'
import Subjects from './components/Subjects'
import Plan from './components/Plan'
import Settings from './components/Settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [focusSubjectId, setFocusSubjectId] = useState<string | null>(null)
  // Navigation with optional subject deep-link (Today/Subjects → Plan).
  const go = (t: Tab, subjectId?: string) => {
    setFocusSubjectId(subjectId ?? null)
    setTab(t)
  }
  return (
    <ThemeProvider>
      <AppProvider>
        {tab === 'today' && <Today go={go} />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'plan' && <Plan focusSubjectId={focusSubjectId} />}
        {tab === 'subjects' && <Subjects go={go} />}
        {tab === 'settings' && <Settings />}
        <NavBar tab={tab} onChange={(t) => go(t)} />
      </AppProvider>
    </ThemeProvider>
  )
}
