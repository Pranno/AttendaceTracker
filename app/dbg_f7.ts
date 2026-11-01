import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns, readGridBoxes } from './src/logic/timetableImport'
const pages = divF as any[]
const pg = pages[0]
const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: 0 }))
const cols = findDayColumns(frags)
const leftLimit = cols[0].x - 20
console.log('leftLimit:', leftLimit)
// replicate band merge incl. the "drop lower shared-endpoint" rule
const DASH_RE = /^[-–—]+$/
const TIME_TOKEN_RE = /^\d{1,2}[.:]\d{2}$/
function extractRowTimes(parts: string[]) {
  const glued: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (/^\d{1,2}[.:]$/.test(p) && i + 1 < parts.length && /^\d{1,2}$/.test(parts[i + 1])) glued.push(`${p.replace('.', ':')}${parts[++i].padStart(2, '0')}`)
    else glued.push(p)
  }
  const times: string[] = []
  for (const p of glued) {
    if (DASH_RE.test(p)) continue
    const m = /(\d{1,2}[.:]\d{2})\s*[-–—]\s*(\d{1,2}[.:]\d{2})/.exec(p)
    if (m) { times.push(m[1], m[2]); continue }
    const lead = /^(\d{1,2}[.:]\d{2})\s*[-–—]/.exec(p)
    if (lead) { times.push(lead[1]); continue }
    if (TIME_TOKEN_RE.test(p)) times.push(p)
  }
  const norm = (s: string): string | null => { const m = /^(\d{1,2})[.:](\d{2})$/.exec(s); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); if (h > 23 || mi > 59) return null; return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}` }
  const out: { start: string; end: string }[] = []
  for (let i = 0; i + 1 < times.length; i += 2) { const a = norm(times[i]), b = norm(times[i+1]); if (a && b && a !== b) out.push({ start: a, end: b }) }
  return out
}
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
const rawBands: Band[] = []
for (const { y, row } of yGroups.values()) {
  const ts = extractRowTimes(row.sort((a,b)=>a.x-b.x).map(f=>f.str.trim()))
  console.log(`y=${y}: parts=${JSON.stringify(row.map(f=>f.str))} -> times=${JSON.stringify(ts)}`)
  for (const t of ts) rawBands.push({ ...t, yTop: y, yBottom: y, page: 0 })
}
rawBands.sort((a,b)=>b.page-a.page||b.yTop-a.yTop)
const merged: Band[] = []
for (const b of rawBands) {
  const prev = merged.length ? merged[merged.length-1] : null
  if (prev && prev.page === b.page && Math.abs(prev.yTop - b.yTop) <= 5) {
    if (prev.start === b.start && prev.end === b.end) { prev.yBottom = Math.min(prev.yTop, b.yTop) }
    else if (prev.start === b.start || prev.end === b.end) { prev.yBottom = Math.min(prev.yTop, b.yTop) }
    else { prev.start = prev.start < b.start ? prev.start : b.start; prev.end = prev.end > b.end ? prev.end : b.end; prev.yBottom = Math.min(prev.yTop, b.yTop) }
    console.log(`MERGE row-dup: ${b.start}-${b.end} into prev`)
    continue
  }
  if (merged.length) {
    const near = merged[merged.length-1]
    if (near.page === b.page && Math.abs(near.yTop - b.yTop) <= 10 && (b.start === near.end || b.end === near.start)) { console.log(`DROP endpoint: ${b.start}-${b.end} vs near ${near.start}-${near.end}`); continue }
  }
  merged.push(b)
}
console.log('FINAL BANDS:', JSON.stringify(merged))
