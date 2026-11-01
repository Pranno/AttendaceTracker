import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns, parseTimetablePages, readGridBoxes } from './src/logic/timetableImport'

const pages = divF as any[]

// Full pipeline first
const res = parseTimetablePages(pages)
console.log('FULL PIPELINE entries:', res.entries.length)

// Inspect page 0 left-column time labels (the band sources)
{
  const items = pages[0].items || pages[0]
  const dayCols = findDayColumns(
    items.filter((it: any) => it.transform).map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: 0 })),
  )
  const leftLimit = dayCols.length ? dayCols[0].x - 20 : 0
  const left = items
    .filter((it: any) => it.transform && it.transform[4] < leftLimit && /\d/.test(it.str))
    .sort((a: any, b: any) => b.transform[5] - a.transform[5])
    .map((it: any) => `${Math.round(it.transform[5])}: ${JSON.stringify(it.str)}`)
  console.log('page0 left-col numeric frags:\n' + left.join('\n'))
}

// Per-page replication
pages.forEach((pg, i) => {
  const items = pg.items || pg
  const frags = items
    .filter((it: any) => it.transform && Number.isFinite(it.transform[5]))
    .map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: i }))
    .filter((f: any) => f.str)
  const dayCols = findDayColumns(frags)
  const cols = dayCols.length >= 4 ? dayCols : null
  if (cols) {
    const warnings: string[] = []
    const entries = readGridBoxes(frags, cols, warnings)
    console.log(`page ${i}: HEADER page -> readGridBoxes gave ${entries.length} entries`)
  } else {
    console.log(`page ${i}: no header, skipped in this replication`)
  }
})
