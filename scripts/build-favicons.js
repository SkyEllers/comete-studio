// Génération des favicons PNG depuis favicon.svg
// Run: node scripts/build-favicons.js
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const svgPath = path.join(root, 'favicon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const VOID = '#0A0A0A';

const tasks = [
  { out: 'favicon-16.png',        size: 16,  bg: { r: 0, g: 0, b: 0, alpha: 0 } },
  { out: 'favicon-32.png',        size: 32,  bg: { r: 0, g: 0, b: 0, alpha: 0 } },
  { out: 'apple-touch-icon.png',  size: 180, bg: VOID },
];

for (const t of tasks) {
  await sharp(svgBuffer, { density: 384 })
    .resize(t.size, t.size, { fit: 'contain', background: t.bg })
    .flatten({ background: t.bg })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, t.out));
  const stat = fs.statSync(path.join(root, t.out));
  console.log(`${t.out}: ${t.size}×${t.size}, ${stat.size} bytes`);
}
