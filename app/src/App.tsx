// Step-1 app shell: four tabs. The floating pill navigation with the sliding
// active pill and quick-add button is built properly in Step 2 (Design section).

import { useState } from 'react'
import { AppProvider } from './data/store'
import Today from './components/Today'
import Timetable from './components/Timetable'
import Settings from './components/Settings'

type Tab = 'today' | 'timetable' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  return (
    <AppProvider>
      <div className="app">
        {tab === 'today' && <Today />}
        {tab === 'timetable' && <Timetable />}
        {tab === 'settings' && <Settings />}
      </div>
      <nav className="tabs">
        <button className={tab === 'today' ? 'primary' : ''} onClick={() => setTab('today')}>
          Today
        </button>
        <button
          className={tab === 'timetable' ? 'primary' : ''}
          onClick={() => setTab('timetable')}
        >
          Timetable
        </button>
        <button
          className={tab === 'settings' ? 'primary' : ''}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </nav>
    </AppProvider>
  )
}
