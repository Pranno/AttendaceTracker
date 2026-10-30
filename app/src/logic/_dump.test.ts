import fs from 'node:fs'
import { it, expect } from 'vitest'
import { parseTimetablePages, type Frag } from './timetableImport'

const glued = JSON.parse(fs.readFileSync('/tmp/glued.json', 'utf8'))

it('debug glue splitter', () => {
  // replicate the splitter on one glued line
  const ENTRY_TOK_RE = /[A-Z][A-Z0-9]*(?:-[IVX]+)?\s*\(\s*[LPTS]\s*\)/i
  const TIME_HEAD_RE = /\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?/
  const f = { x: 65, end: 65 + 300, y: 320, str: '8:00 - 9:00 A2 WAD (P) YP 2314 A FE (L) PS 2406', page: 0 }
  console.log('wide:', f.end - f.x, 'time:', TIME_HEAD_RE.test(f.str), 'entries:', (f.str.match(ENTRY_TOK_RE) ?? []).length)
  const re = new RegExp(String.raw`${ENTRY_TOK_RE.source}[^]*?(?=${TIME_HEAD_RE.source})`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(f.str))) console.log('cut at', m.index + m[0].length, JSON.stringify(m[0]))
  // day header detection on glued fixture
  const pages = glued as any
  const firstLine = pages[0].find((p: any) => /Monday/.test(p.str))
  console.log('header frag:', JSON.stringify(firstLine))
  expect(true).toBe(true)
})

it('glued parse dump', () => {
  const res = parseTimetablePages(glued as any)
  console.log('GLUED entries:', res.entries.length, 'warnings:', JSON.stringify(res.warnings))
  for (const e of res.entries.slice(0, 40)) {
    console.log(`wd=${e.weekday} ${e.startTime}-${e.endTime} batch=${e.batch ?? '-'} subj=${e.subjectShort} review=${e.needsReview}`)
  }
  expect(true).toBe(true)
})
