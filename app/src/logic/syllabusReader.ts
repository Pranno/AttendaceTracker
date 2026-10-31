// ============================================================
// Shared PDF text-layout helpers.
//
// pdfjs hands us loose text fragments, each with an x/y position.
// groupItemsIntoLines() reassembles them into visual lines: fragments
// whose vertical span overlaps are merged left-to-right into one line,
// and the page index is kept so lines from different pages never mix
// (PDF y-coordinates restart on every page).
//
// Used by the timetable importer (Timetable tab). The syllabus reader
// that used to live here was removed together with its UI — see
// docs/PROGRESS.md for what remains vs. the requirements doc.
// ============================================================

export interface TextItemLike {
  str: string
  /** pdfjs transform matrix: [a, b, c, d, x, y] */
  transform: number[]
  width?: number
}

export interface LineItem {
  str: string
  x: number
  end: number
  y: number
  /** Original unrounded transform[5] (kept for the timetable grid parser). */
  rawY?: number
}

export interface Line {
  items: LineItem[]
  text: string
  /** first item's left edge */
  x: number
  /** rightmost edge of the line */
  end: number
  y: number
  page: number
}

/** Group positioned fragments into visual lines (overlapping y ranges). */
export function groupItemsIntoLines(items: TextItemLike[], page = 0): Line[] {
  const frags: LineItem[] = items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => {
      const x = it.transform[4]
      const y = it.transform[5]
      const w = it.width ?? it.str.length * 6
      return { str: it.str, x, end: x + w, y, rawY: y }
    })
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: Line[] = []
  for (const f of frags) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - f.y) <= 4) {
      last.items.push(f)
      last.end = Math.max(last.end, f.end)
    } else {
      lines.push({ items: [f], text: '', x: f.x, end: f.end, y: f.y, page })
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x)
    ln.text = ln.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines.filter((ln) => ln.text.length > 0)
}
