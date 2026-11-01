import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns, readGridBoxes } from './src/logic/timetableImport'
const pages = divF as any[]
// replicate frag building like parseTimetablePages (simplified: raw items)
pages.slice(0,2).forEach((pg, pi) => {
  const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
  const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: pi }))
  const cols = findDayColumns(frags)
  console.log(`page ${pi}: dayCols=`, JSON.stringify(cols))
  if (cols.length >= 4) {
    const w: string[] = []
    const es = readGridBoxes(frags, cols, w)
    console.log(`page ${pi}: entries=${es.length}`, JSON.stringify(es.slice(0,6)))
    console.log('warnings:', w)
  }
})
