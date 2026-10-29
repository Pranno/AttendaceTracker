import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), disableFontFace: true }).promise;
let out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const items = tc.items.filter(it => it.str.trim()).map(it => ({
    str: it.str, x: it.transform[4], y: it.transform[5], h: it.height, w: it.width
  }));
  // sort by y desc, then x asc
  items.sort((a,b)=> b.y - a.y || a.x - b.x);
  out.push(`===== PAGE ${p} =====`);
  for (const it of items) {
    out.push(`y=${Math.round(it.y*10)/10} x=${Math.round(it.x)} h=${Math.round(it.h*10)/10} "${it.str}"`);
  }
}
fs.writeFileSync('/tmp/pdfjs_items.txt', out.join('\n'));
console.log('items', out.length);
