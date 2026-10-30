import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import type { TextItemLike } from './syllabusReader'
import { groupItemsIntoLines } from './syllabusReader'

const ENTRY_RE_TEST = /^(?:(?<batch>[A-E](?:[1-9])?)[.\s-]+)?(?<subj>[A-Z][A-Z0-9]*(?:-[IVX]+)?)\s*(\(\s*[LPTS]\s*\)|\([LPTS][A-Za-z(]|\(\s+[LPTS]\s+\))/

it('bands', () => {
  // replicate band construction quickly: dump all fragments with x < 150 (time labels) page 0
  fixtures.forEach((pg, pi) => {
    if (pi > 1) return
    for (const ln of groupItemsIntoLines(pg as TextItemLike[], pi)) {
      const left = ln.items.filter((i) => i.x < 150)
      if (left.length) console.log(`P${pi} y=${ln.y} items=${JSON.stringify(ln.items.map(i=>({x:i.x,s:i.str})))}`)
    }
  })
})
