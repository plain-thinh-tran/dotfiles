// Usage: node snap.mjs <scene.html> <outDir> <seconds...>
// Screenshots the scene at each time using the renderer's own virtual clock.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const dir = process.env.SHIPVIDEO_DIR ?? `${process.env.HOME}/workspace/shipvideo-local`;
const require = createRequire(join(dir, 'package.json'));
const { chromium } = require('playwright-core');
const src = readFileSync(join(dir, 'local/render.mjs'), 'utf8');
const CLOCK = (0, eval)(src.match(/const CLOCK = (`[\s\S]*?`);/)[1]);

const [scene, outDir, ...times] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(CLOCK);
const page = await ctx.newPage();
await page.setContent(readFileSync(resolve(scene), 'utf8'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => window.__seek(0));
for (const t of times.map(Number)) {
  await page.evaluate((ms) => window.__seek(ms), t * 1000);
  await page.screenshot({ path: join(outDir, `t_${t}.png`) });
}
await browser.close();
