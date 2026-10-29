import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), disableFontFace: true }).promise;
let out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const lines = new Map();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.transform[5]);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x: Math.round(it.transform[4]), str: it.str });
  }
  out.push(`===== PAGE ${p} =====`);
  for (const y of [...lines.keys()].sort((a,b)=>b-a)) {
    const items = lines.get(y).sort((a,b)=>a.x-b.x);
    out.push(`${y} ` + items.map(i=>`${i.str}@${i.x}`).join(' | '));
  }
}
fs.writeFileSync('/tmp/pdfjs_layout.txt', out.join('\n'));
console.log('done', out.length);
