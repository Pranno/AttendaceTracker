// Reusable UI parts built on the design tokens (Step 2: "design tokens and
// reusable parts first"). Everything here is pill/round-shaped, ≥48px tap
// targets, and uses var(--token) colours only.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// ------------------------------------------------------------
// useCountUp — numbers count up when a screen opens / value changes.
// Respects the phone's "reduce motion" setting.
// ------------------------------------------------------------
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || durationMs <= 0) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setValue(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return value
}

// ------------------------------------------------------------
// PercentRing — the big attendance ring in safe / limit / danger colour.
// Fills smoothly when the value changes (CSS transition on stroke-dashoffset).
// ------------------------------------------------------------
export function PercentRing({
  percent,
  size = 120,
  stroke = 12,
  color,
  label,
}: {
  percent: number
  size?: number
  stroke?: number
  color: string
  label?: string
}) {
  const shown = useCountUp(percent)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="ring" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card)" strokeOpacity={0.25} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.22,1,.36,1), stroke 0.3s' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 0,
        }}
      >
        <span className="num big" style={{ color, fontSize: size * 0.24 }}>{shown.toFixed(1)}%</span>
        {label && <span className="small-label">{label}</span>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// StatusPill — small fully-round pill with a coloured dot/fill (J10 colours).
// ------------------------------------------------------------
export function StatusPill({
  tone,
  children,
}: {
  tone: 'safe' | 'limit' | 'below' | 'neutral' | 'primary'
  children: ReactNode
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

// ------------------------------------------------------------
// SectionTitle — small, capital, letter-spaced ("THIS MONTH" style).
// ------------------------------------------------------------
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>
}

// ------------------------------------------------------------
// Sheet — bottom sheet sliding up over the content (calendar day view, quick add).
// 28px top radius per tokens; closes on backdrop tap or ✕.
// ------------------------------------------------------------
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        <div className="row spread" style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 18 }}>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Chip row — rounded filter chips (All / Today / This week).
// ------------------------------------------------------------
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="chip-row" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={`chip ${o.id === value ? 'on' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------
// Toggle switch — 48px tall row target, round knob.
// ------------------------------------------------------------
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  )
}

// ------------------------------------------------------------
// SliderField — big number + emoji + slider (threshold & assumed % in Settings).
// ------------------------------------------------------------
export function SliderField({
  label,
  value,
  min,
  max,
  onChange,
  emojiFor,
  hint,
  suffix = '%',
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
  emojiFor?: (n: number) => string
  hint?: string
  suffix?: string
}) {
  return (
    <div className="card">
      <div className="small-label field-label">{label}</div>
      <div className="row spread">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="grow slider"
          aria-label={label}
        />
        <b className="num slider-value">
          {emojiFor ? `${emojiFor(value)} ` : ''}
          {value}
          {suffix}
        </b>
      </div>
      {hint && <div className="msg">{hint}</div>}
    </div>
  )
}
