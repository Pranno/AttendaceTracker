import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const doc = await getDocument({ data: new Uint8Array(await (await import('node:fs')).promises.readFile(process.argv[2])), disableFontFace: true }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const lines = new Map();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.transform[5]);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x: it.transform[4], str: it.str });
  }
  console.log(`===== PAGE ${p} =====`);
  for (const y of [...lines.keys()].sort((a,b)=>b-a)) {
    const items = lines.get(y).sort((a,b)=>a.x-b.x);
    console.log(y, items.map(i=>`${i.str}@${Math.round(i.x)}`).join(' | ').slice(0,220));
  }
}
