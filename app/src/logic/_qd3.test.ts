import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { parseTimetablePages, findDayColumns } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

it('cols per page', () => {
  const pages = fixtures as unknown as TextItemLike[][]
  // replicate frag extraction through the public entry by monkey-scanning: use findDayColumns on raw items? It needs Frag. Instead call parse and inspect via a debug hook is not available; do manual conversion here mirroring parser: group lines not needed — approximate with transform directly.
  pages.forEach((pg, i) => {
    const frags = pg.filter(x => Array.isArray(x.transform)).map(x => ({ x: x.transform![4], end: x.transform![4] + (x.width||0), y: x.transform![5], str: x.str.trim(), page: i }))
    console.log('PAGE', i, JSON.stringify(findDayColumns(frags as any)))
  })
})
