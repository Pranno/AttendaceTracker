import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns } from './src/logic/timetableImport'
const pages = divF as any[]
const pg = pages[0]
const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: 0 }))
const cols = findDayColumns(frags)
const leftLimit = cols[0].x - 20
// replicate band building
interface Band { start: string; end: string; yTop: number; yBottom: number; page: number }
const yGroups = new Map<string, { y: number; row: any[] }>()
for (const f of frags) {
  if (f.x >= leftLimit) continue
  if (!/\d/.test(f.str)) continue
  let matched: string | undefined
  for (const [k, g] of yGroups) { if (Number(k.split('|')[0]) !== f.page) continue; if (Math.abs(g.y - f.y) <= 6) { matched = k; break } }
  if (matched === undefined) yGroups.set(`${f.page}|${f.y}`, { y: f.y, row: [f] })
  else yGroups.get(matched)!.row.push(f)
}
console.log('yGroups:', [...yGroups.values()].map(g=>g.row.map(f=>f.str).join('+')))
// inline extractRowTimes copy? import not exported... replicate logic by requiring module via tsx eval — simpler: just print what pairs SHOULD be:
