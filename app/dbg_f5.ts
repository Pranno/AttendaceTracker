import divF from './src/logic/__fixtures__/tt-divF.json'
import { findDayColumns, readGridBoxes } from './src/logic/timetableImport'
const pages = divF as any[]
pages.forEach((pg, pi) => {
  const items = (pg.items || pg).filter((it: any) => it.transform && it.str.trim())
  const frags = items.map((it: any) => ({ x: it.transform[4], end: it.transform[4] + (it.width || 0), y: it.transform[5], str: it.str.trim(), page: pi }))
  let cols = findDayColumns(frags)
  if (!cols.length && pi > 0) cols = findDayColumns((pages[0].items||pages[0]).filter((it:any)=>it.transform).map((it:any)=>({x:it.transform[4],end:it.transform[4]+(it.width||0),y:it.transform[5],str:it.str.trim(),page:pi})))
  if (!cols.length) { console.log(`page ${pi}: no cols`); return }
  const w: string[] = []
  const es = readGridBoxes(frags, cols, w)
  console.log(`page ${pi}: entries=${es.length}`)
  es.slice(0,8).forEach(e=>console.log('  ', e.weekday, e.startTime+'-'+e.endTime, e.batch, e.subjectShort, e.type, e.teacher, e.room))
})
