import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

it('dump fragments', () => {
  const pages = fixtures as unknown as TextItemLike[][]
  pages.forEach((frags, pi) => {
    console.log(`=== PAGE ${pi} (${frags.length} frags) ===`)
    const rows: Record<number, string[]> = {}
    for (const f of frags) {
      const y = Math.round(f.y)
      const k = y - (y % 5)
      ;(rows[k] ||= []).push(`x${Math.round(f.x)}:${f.str}`)
    }
    Object.keys(rows).map(Number).sort((a,b)=>a-b).forEach(y => console.log(y, rows[y].join(' | ')))
  })
})
