// ThemeProvider — writes the design tokens into CSS custom properties on
// <html>, and switches between Sunrise (light), Midnight (dark) and Follow
// the phone (F9). Choice is persisted in localStorage so it survives reloads.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { THEME_TOKENS } from './tokens'
import type { ThemeName } from './tokens'

export type ThemeChoice = ThemeName | 'system'

const KEY = 'attendancetracker.theme'

interface ThemeApi {
  /** The user's picker choice: sunrise | midnight | system */
  choice: ThemeChoice
  /** The theme actually applied right now. */
  active: ThemeName
  setChoice: (c: ThemeChoice) => void
}

const Ctx = createContext<ThemeApi | null>(null)

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => {
    const saved = localStorage.getItem(KEY)
    return saved === 'midnight' || saved === 'sunrise' || saved === 'system' ? saved : 'sunrise'
  })
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const active: ThemeName = choice === 'system' ? (systemDark ? 'midnight' : 'sunrise') : choice

  useEffect(() => {
    const root = document.documentElement
    const tokens = THEME_TOKENS[active]
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v)
    root.dataset.theme = active
    // Colour the browser chrome / status bar area to match the header.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', tokens.headerTo)
  }, [active])

  const api = useMemo<ThemeApi>(
    () => ({
      choice,
      active,
      setChoice: (c) => {
        localStorage.setItem(KEY, c)
        setChoiceState(c)
      },
    }),
    [choice, active],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
