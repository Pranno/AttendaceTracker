import { readFileSync } from 'node:fs'
import { parseSyllabusPages } from '../src/logic/syllabusReader'

type Item = { str: string; transform: number[]; width?: number }
const pages = JSON.parse(readFileSync('src/logic/__fixtures__/syllabus-sem1.json', 'utf8')) as Item[][]
const result = parseSyllabusPages(pages)
for (const s of result.subjects) {
  console.log(`\n### ${s.code} — ${s.shortName} — ${s.fullName}`)
  for (const u of s.units) {
    console.log(`  U${u.number} "${u.title}" hrs=${u.hours} review=${u.needsReview} topics=${u.topics.length}`)
    for (const t of u.topics.slice(0, 3)) console.log(`     - ${t.name.slice(0, 80)}${t.needsSplit ? ' [S17]' : ''}${t.group ? ` (grp:${t.group})` : ''}`)
    if (u.topics.length > 3) console.log(`     ... +${u.topics.length - 3} more`)
  }
  for (const c of s.links) console.log(`  LINK "${c.name}" url=${c.url} co=${c.coNumber} unit=${c.unitLabel} chk=${c.needsChecking} other=${c.otherSite} nolink=${c.noLink}`)
}
console.log('\nTOTAL UNITS:', result.subjects.reduce((n, s) => n + s.units.length, 0), 'LINKS:', result.subjects.flatMap(s=>s.links).length)
