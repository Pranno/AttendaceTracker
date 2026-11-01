import divF from './src/logic/__fixtures__/tt-divF.json'
const pages = divF as any[]
pages.forEach((pg, i) => {
  const items = (pg.items || pg).filter((it: any) => it.transform)
  console.log(`--- page ${i}: ${items.length} positioned items`)
  const rows = new Map<number, any[]>()
  for (const it of items) {
    const y = Math.round(it.transform[5])
    let key: number | undefined
    for (const k of rows.keys()) if (Math.abs(k - y) <= 4) { key = k; break }
    if (key === undefined) rows.set(y, [it]); else rows.get(key)!.push(it)
  }
  const sorted = [...rows.entries()].sort((a,b)=>b[0]-a[0])
  sorted.slice(0, 14).forEach(([y, r]) => {
    console.log(`y=${y} x=${Math.round(Math.min(...r.map((x:any)=>x.transform[4])))}: ` + r.sort((a,b)=>a.transform[4]-b.transform[4]).map((x:any)=>JSON.stringify(x.str)).join(' | ').slice(0,200))
  })
})
