import { it } from 'vitest'
import fs from 'fs'
import type { TextItemLike } from './src/logic/syllabusReader'
import { parseTimetablePages } from './src/logic/timetableImport'

it('probe', () => {
  const pages = JSON.parse(fs.readFileSync('./src/logic/__fixtures__/tt-divF.json', 'utf8')) as TextItemLike[][]
  // monkeypatch: log what readGridBoxes sees by re-running internals via exported fns is hard;
  // instead just print entries per page after parse.
  const res = parseTimetablePages(pages)
  console.log('entries', res.entries.length, 'warnings', JSON.stringify(res.warnings))
})
