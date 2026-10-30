// Extracts pdfjs text items (with positions) from a syllabus PDF into JSON,
// so the vitest suite can run the reader offline without the pdfjs worker.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: node scripts/syllabus-extract.mjs <in.pdf> <out.json>')
  process.exit(1)
}
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(inPath)), disableFontFace: true }).promise
const pages = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ str: it.str, transform: it.transform, width: it.width })))
}
fs.writeFileSync(outPath, JSON.stringify(pages))
console.log(`wrote ${pages.length} pages to ${outPath}`)
