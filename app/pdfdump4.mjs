import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), disableFontFace: true }).promise;
let out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  out.push(`===== PAGE ${p} =====`);
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    out.push(`y=${Math.round(it.transform[5]*10)/10} x=${Math.round(it.transform[4])} w=${Math.round(it.width)} "${it.str}" hasEOL=${!!it.hasEOL}`);
  }
}
fs.writeFileSync('/tmp/pdfjs_raw.txt', out.join('\n'));
console.log('ok');
