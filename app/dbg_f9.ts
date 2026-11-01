import divF from './src/logic/__fixtures__/tt-divF.json'
const pages = divF as any[]
pages.forEach((pg: any, pi: number) => {
  const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
  const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: pi }))
  // rows grouping ±2
  interface ERow { y: number; frags: any[] }
  const eRows: ERow[] = []
  for (const f of frags) {
    let r = eRows.find((x) => Math.abs(x.y - f.y) <= 2)
    if (!r) { r = { y: f.y, frags: [] }; eRows.push(r) }
    r.frags.push(f)
  }
  const lines = [...eRows].sort((a,b)=>b.y-a.y).map(r=>({y:r.y, ln:r.frags.sort((a,b)=>a.x-b.x).map(f=>f.str).join(' ')}))
  console.log(`=== page ${pi} ===`)
  lines.forEach(l=>console.log(`y=${Math.round(l.y*10)/10}: ${l.ln.slice(0,170)}`))
})
