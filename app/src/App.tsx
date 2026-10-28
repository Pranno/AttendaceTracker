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
import Settings from './components/Settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  return (
    <ThemeProvider>
      <AppProvider>
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'subjects' && <Subjects go={setTab} />}
        {tab === 'settings' && <Settings />}
        <NavBar tab={tab} onChange={setTab} />
      </AppProvider>
    </ThemeProvider>
  )
}
