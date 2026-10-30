import { describe, it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'

describe('page1 raw items', () => {
  it('dump rows', () => {
    const pages = fixtures as any[]
    for (let pi = 0; pi < pages.length; pi++) {
      const rows: Record<string, string[]> = {}
      for (const it of pages[pi]) {
        if (!it.str?.trim() || !it.transform) continue
        const y = Math.round(it.transform[5] / 6.9) * 6.9
        ;(rows[y] ||= []).push(`${it.transform[4].toFixed(0)}:${JSON.stringify(it.str)}(w=${(it.width??0).toFixed(0)})`)
      }
      console.log(`### PAGE ${pi}`)
      Object.keys(rows).map(Number).sort((a,b)=>b-a).forEach(y => console.log(`y=${y} | ` + rows[y].join(' ')))
    }
  })
})
