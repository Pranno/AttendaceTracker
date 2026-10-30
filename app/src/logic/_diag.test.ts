import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import type { TextItemLike } from './syllabusReader'

const TYPE_TOK = String.raw`\(\s*[LPTS]\s*\)|\([LPTS][A-Za-z(]|\(\s+[LPTS]\s+\)`
const ENTRY_RE = new RegExp(
  String.raw`^(?:(?<batch>[A-E](?:[1-9])?)[.\s-]+)?(?<subj>[A-Z][A-Z0-9]*(?:-[IVX]+)?)\s*` +
    `(?<typeTok>${TYPE_TOK})\\s*(?:(?<teacher>[A-Z][A-Za-z0-9]{1,3})(?:\\s+(?<room>\\d{3,4}))?)?`,
)
function normalizeTypeTok(text: string): string {
  return text
    .replace(/\(\s+([LPTS])\s+\)/g, '($1)')
    .replace(/\(\s*([LPTS])\s*\)/g, '($1)')
    .replace(/\(([LPTS])(?=[A-Za-z(])/g, '($1) ')
}

it('diag bands', () => {
  const pages = fixtures as unknown as TextItemLike[][]
  // replicate fragment building like parseTimetablePages
  interface F { x:number; end:number; y:number; str:string; page:number }
  const frags: F[] = []
  pages.forEach((pg, pi) => {
    for (const it of pg) {
      const s = (it.str||'').trim()
      if (!s) continue
      const t = it.transform
      if (!Array.isArray(t) || t.length < 6) continue
      frags.push({ x: Math.round(t[4]), end: Math.round(t[4] + (it.width ?? s.length*4)), y: t[5], str: s, page: pi })
    }
  })
  const p0 = frags.filter(f=>f.page===0)
  // group with tol 2
  interface R { y:number; frags:F[] }
  const rows: R[] = []
  for (const f of p0) {
    let r = rows.find(x=>Math.abs(x.y-f.y)<=2)
    if(!r){r={y:f.y,frags:[]};rows.push(r)}
    r.frags.push(f)
  }
  for (const r of rows.sort((a,b)=>b.y-a.y)) {
    const ln = normalizeTypeTok([...r.frags].sort((a,b)=>a.x-b.x).map(f=>f.str).join(' '))
    const m = ENTRY_RE.exec(ln)
    console.log(`y=${r.y.toFixed(1)} idx=${m?m.index:'x'} | ${ln.slice(0,80)}`)
  }
})
