// Génère assets/og-image.png 1200×630 depuis scripts/og-template.html
// Run: node scripts/build-og-image.js
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const templateUrl = 'file://' + path.join(root, 'scripts', 'og-template.html').replaceAll('\\', '/');
const outPath = path.join(root, 'assets', 'og-image.png');

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.goto(templateUrl, { waitUntil: 'networkidle0' });
await page.evaluateHandle('document.fonts.ready');
await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();

const stat = fs.statSync(outPath);
console.log(`og-image.png: 1200×630, ${stat.size} bytes (${(stat.size/1024).toFixed(1)} KB)`);
