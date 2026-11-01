import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns } from './src/logic/timetableImport'
const pages = divF as any[]
const pg = pages[0]
const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: 0 }))
const cols = findDayColumns(frags)
// replicate eRows ±2 grouping and startsWithEntry test
const ENTRY_RE = new RegExp(
  String.raw`^(?:(?<batch>[A-E](?:[1-9])?)[.\s-]+)?(?<subj>[A-Z][A-Z0-9]*(?:-[IVX]+)?)\s*` +
    `(?<typeTok>\(\s*[LPTS]\s*\))\\s*(?:(?<teacher>[A-Z][A-Za-z0-9]{1,3})(?:\s+(?<room>\d{3,4}))?)?`,
)
interface ERow { y: number; frags: any[] }
const baseRow = (y: number) => Math.round(y*2)/2
const eRows: ERow[] = []
for (const f of frags) {
  let r = eRows.find((x) => Math.abs(x.y - f.y) <= 2)
  if (!r) { r = { y: baseRow(f.y), frags: [] }; eRows.push(r) }
  r.frags.push(f)
}
const startsWithEntry = (ln: string): boolean => {
  const m = ENTRY_RE.exec(ln)
  return !!m && m.index <= 4 && /\(\s*[LPTS]\s*\)|\([LPTS][A-Za-z(]/.test(ln.slice(m.index ?? 0, (m.index ?? 0) + 40))
}
for (const r of [...eRows].sort((a,b)=>b.y-a.y)) {
  const ln = r.frags.sort((a,b)=>a.x-b.x).map(f=>f.str.trim()).join(' ')
  console.log(`y=${r.y}: ${JSON.stringify(ln)} -> entry=${startsWithEntry(ln)}`)
}
