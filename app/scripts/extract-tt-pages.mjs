// Dev helper: extract per-page positioned text items from a timetable PDF,
// exactly as the app's pdf.js reader does, and write a JSON fixture.
// Usage: node scripts/extract-tt-pages.mjs ../att.pdf src/logic/__fixtures__/tt-divA.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: node extract-tt-pages.mjs <input.pdf> <output.json>')
  process.exit(1)
}

const data = new Uint8Array(readFileSync(resolve(inPath)))
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise
const pages = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent()
  // Keep only what the parser needs: str + transform (x=e, y=f) + width.
  const items = content.items
    .filter((it) => typeof it.str === 'string' && it.str.trim().length > 0)
    .map((it) => ({ str: it.str, transform: it.transform, width: it.width }))
  pages.push(items)
}
mkdirSync(dirname(resolve(outPath)), { recursive: true })
writeFileSync(resolve(outPath), JSON.stringify(pages))
console.log(`${inPath}: ${pages.length} pages, ${pages.reduce((s, x) => s + x.length, 0)} items -> ${outPath}`)
