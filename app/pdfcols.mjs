import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const doc = await getDocument({ data: new Uint8Array(await (await import('node:fs')).promises.readFile(process.argv[2])), disableFontFace: true }).promise;
const p0 = Number(process.argv[3] || 1), p1 = Number(process.argv[4] || p0);
for (let p = p0; p <= p1; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const lines = new Map();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.transform[5]);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x: Math.round(it.transform[4]), str: it.str });
  }
  console.log(`===== PAGE ${p} =====`);
  for (const y of [...lines.keys()].sort((a,b)=>b-a)) {
    const items = lines.get(y).sort((a,b)=>a.x-b.x);
    const cols = items.map(i=>`[${i.x}]${i.str}`).join(' ');
    console.log(`${y}: ${cols}`);
  }
}
