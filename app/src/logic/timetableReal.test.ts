// Temporary analysis harness over the three real division PDFs (att/ctt/ftt),
// extracted with scripts/extract-tt-pages.mjs. Prints what the parser reads
// so we can measure accuracy and spot break-row duplicates / dropped pages.
import { describe, it } from 'vitest'
import divA from './__fixtures__/tt-divA.json'
import divC from './__fixtures__/tt-divC.json'
import divF from './__fixtures__/tt-divF.json'
import { parseTimetablePages, distinctBatches } from './timetableImport'
import type { TextItemLike } from './syllabusReader'

const files: [string, unknown][] = [
  ['DivA', divA],
  ['DivC', divC],
  ['DivF', divF],
]

describe('real timetable PDFs (analysis)', () => {
  for (const [name, pages] of files) {
    it(`${name}: dump`, () => {
      const res = parseTimetablePages(pages as unknown as TextItemLike[][])
      const byDay = new Map<number, string[]>()
      for (const e of res.entries) {
        const row = `${e.startTime}-${e.endTime} ${e.batch ?? '-'} ${e.subjectShort}(${e.type[0].toUpperCase()}) ${e.teacher || '?'}/${e.room || '?'}`
        if (!byDay.has(e.weekday)) byDay.set(e.weekday, [])
        byDay.get(e.weekday)!.push(row)
      }
      console.log(`\n===== ${name}: ${res.entries.length} entries, batches=${JSON.stringify(distinctBatches(res.entries))}, subjects=${res.subjects.length}`)
      console.log(`warnings: ${JSON.stringify(res.warnings)}`)
      for (const wd of [...byDay.keys()].sort((a, b) => a - b)) {
        console.log(`--- day ${wd}`)
        console.log(byDay.get(wd)!.sort().join('\n'))
      }
      const flagged = res.entries.filter((e) => e.needsReview)
      if (flagged.length) console.log(`NEEDS REVIEW (${flagged.length}):\n` + flagged.map((f) => f.raw).join('\n'))
    })
  }
})
