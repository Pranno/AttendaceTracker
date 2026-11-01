import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns } from './src/logic/timetableImport'
const pages = divF as any[]
const pg = pages[0]
const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: 0 }))
const cols = findDayColumns(frags)
const leftLimit = cols[0].x - 20
const numeric = frags.filter(f => f.x < leftLimit && /\d/.test(f.str))
console.log('numeric left frags:', JSON.stringify(numeric.map(f=>({x:f.x,y:f.y,str:f.str}))))
// replicate yGroups
const yGroups = new Map<string, { y: number; row: any[] }>()
for (const f of numeric) {
  let matched: string | undefined
  for (const [k, g] of yGroups) { if (Number(k.split('|')[0]) !== f.page) continue; if (Math.abs(g.y - f.y) <= 6) { matched = k; break } }
  if (matched === undefined) yGroups.set(`${f.page}|${f.y}`, { y: f.y, row: [f] })
  else yGroups.get(matched)!.row.push(f)
}
for (const [k, g] of [...yGroups.entries()].sort((a,b)=>b[1].y-a[1].y)) console.log(`group ${k}:`, g.row.sort((a,b)=>a.x-b.x).map(f=>JSON.stringify(f.str)).join(' + '))
