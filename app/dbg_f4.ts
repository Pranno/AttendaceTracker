import divF from './src/logic/__fixtures__/tt-divF.json'
import { groupItemsIntoLines } from './src/logic/syllabusReader'
import { findDayColumns } from './src/logic/timetableImport'
const pages = divF as any[]
const pg = pages[0]
const frags: any[] = []
for (const ln of groupItemsIntoLines(pg, 0)) {
  for (const it of ln.items) {
    const s = it.str.trim()
    if (!s) continue
    let y = it.rawY ?? it.y
    if (y === undefined) {
      const src = pg.find((o: any) => o.str === it.str && Math.round(o.transform?.[4] ?? NaN) === it.x)
      const t = src?.transform
      if (Array.isArray(t) && Number.isFinite(t?.[5])) y = t[5]
    }
    if (y === undefined || !Number.isFinite(y)) continue
    frags.push({ x: it.x, end: it.end, y, str: s, page: 0 })
  }
}
console.log('total frags:', frags.length)
const cols = findDayColumns(frags)
console.log('cols:', JSON.stringify(cols))
const leftLimit = cols[0].x - 20
const numeric = frags.filter(f => f.x < leftLimit && /\d/.test(f.str))
console.log('numeric left frags:', JSON.stringify(numeric.map(f=>({x:f.x,y:f.y,str:f.str}))))
// full entry rows anywhere
const entryRows = frags.filter(f => /[A-Z]{2,}\s*\(\s*[LPTS]\s*\)/.test(f.str)).sort((a,b)=>b.y-a.y)
console.log('entry frags sample:', JSON.stringify(entryRows.slice(0,10).map(f=>({x:f.x,y:f.y,str:f.str}))))
