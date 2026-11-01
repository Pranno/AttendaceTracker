import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
const doc = await getDocument({ data: new Uint8Array(readFileSync('/workspace/att.pdf')) }).promise
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  console.log(`===== PAGE ${p} =====`)
  for (const it of tc.items) {
    const t = it.str.trim()
    if (!t) continue
    console.log(`x=${Math.round(it.transform[4])} y=${Math.round(it.transform[5])} w=${Math.round(it.width)} | ${JSON.stringify(it.str)}`)
  }
}
