// Native-style tab swiping: swipe left/right anywhere on the screen to move
// between the bottom-nav tabs (Today → Subjects → Timetable → Calendar →
// Study → Settings).
//
// Guard rules so swipes never fire "randomly" or fight other gestures:
//  - Only horizontal-dominant drags count (angle threshold + min distance).
//  - The gesture is ABANDONED as soon as the finger moves mostly vertically,
//    so scrolling a long list (e.g. the Today screen) never changes tabs.
//  - Touches that start inside horizontally-scrollable areas (the weekday
//    strip, chip rows, timetable grid — anything with overflow-x: auto/scroll)
//    are ignored entirely: dragging there scrolls that element instead.
//  - Touches starting on interactive controls (buttons, links, inputs,
//    selects, textareas) are ignored so taps/typing keep working.
//  - No wrap-around: swiping past the first/last tab does nothing.

import { useEffect } from 'react'

const MIN_X = 60          // px of horizontal travel required
const ANGLE_RATIO = 1.4   // |dx| must exceed |dy| * ratio (≈54° cone)
const MAX_Y = 120         // if vertical drift exceeds this before dx wins, bail

/** Elements whose own horizontal scroll must not be hijacked by tab-swipe. */
function inHorizontalScroller(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const e = n as HTMLElement
    // Explicitly-marked swipe-blockers (e.g. the day strip on Today).
    if (e.hasAttribute?.('data-no-tab-swipe')) return true
    if (e.scrollHeight > e.clientHeight + 4) continue // vertical scroller: fine
    const ox = getComputedStyle(e).overflowX
    if (ox === 'auto' || ox === 'scroll') return true
  }
  return false
}

/** Interactive controls keep their own touch behaviour (tap, type, drag). */
function inInteractive(el: Element | null): boolean {
  const t = el?.closest?.(
    'button, a, input, select, textarea, label, [contenteditable="true"], .pillnav, .fab',
  )
  return !!t
}

export function useTabSwipe(onSwipe: (dir: 1 | -1) => void) {
  useEffect(() => {
    let startX = 0
    let startY = 0
    let active = false // this touch is a swipe candidate

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        active = false
        return
      }
      const t = e.target as Element | null
      active = !inHorizontalScroller(t) && !inInteractive(t)
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      // Vertical intent wins immediately — let the page scroll normally.
      if (Math.abs(dy) > MAX_Y || Math.abs(dy) * ANGLE_RATIO > Math.abs(dx)) {
        active = false
      }
    }

    const onEnd = (e: TouchEvent) => {
      if (!active) return
      active = false
      const ct = e.changedTouches[0]
      const dx = ct.clientX - startX
      const dy = ct.clientY - startY
      if (Math.abs(dx) >= MIN_X && Math.abs(dx) > Math.abs(dy) * ANGLE_RATIO) {
        onSwipe(dx < 0 ? 1 : -1)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', () => (active = false), { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [onSwipe])
}
