// Usage: node shoot.mjs <deck.html> <outDir>
// Steps through every slide and build step with the arrow key, screenshotting each state as
// s<slide>_<step>.png. Relies on the template setting document.body.dataset.pos.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const dir = process.env.SHIPVIDEO_DIR ?? `${process.env.HOME}/workspace/shipvideo-local`;
const require = createRequire(join(dir, 'package.json'));
const { chromium } = require('playwright-core');

const [deck, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${resolve(deck)}`);
await page.waitForTimeout(1200);
const seen = new Set();
for (;;) {
  await page.waitForTimeout(700);
  const pos = await page.evaluate(() => document.body.dataset.pos);
  if (pos === undefined) throw new Error('deck does not set document.body.dataset.pos; use the template navigation script');
  if (seen.has(pos)) break;
  seen.add(pos);
  const [slide, step] = pos.split(':');
  await page.screenshot({ path: join(outDir, `s${Number(slide) + 1}_${step}.png`) });
  await page.keyboard.press('ArrowRight');
}
await browser.close();
console.log(`${seen.size} states`);
