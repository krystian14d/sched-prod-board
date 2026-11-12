// Records the board in use: open-board, watch-board, ack-incident.
// Usage: node scripts/record.mjs <board url> <out name>   → rec/<name>.webm + rec/<name>.json (event times in the video)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

const [url, name = 'run'] = process.argv.slice(2);
if (!url) throw new Error('usage: node scripts/record.mjs <board url> <out name>');
mkdirSync('rec', { recursive: true });

const W = 1280, H = 820;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  locale: 'en-GB',
  timezoneId: 'Europe/Warsaw',
  recordVideo: { dir: 'rec/tmp', size: { width: W, height: H } },
});

// A visible pointer and click ring, so the video shows where each click lands.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = '__cursor';
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,80,.55);border:2px solid #fff;box-shadow:0 0 0 1px #c00;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.8)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
  });
});

const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
const at = () => {
  const s = Math.max(0, (Date.now() - t0) / 1000);
  return { s: +s.toFixed(2), mmss: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` };
};
const events = [];
const log = (what, extra = {}) => { const e = { ...at(), what, ...extra }; events.push(e); console.log(JSON.stringify(e)); };

const acks = [];
page.on('response', async (res) => {
  if (res.url().includes('/ack?')) {
    try { const body = await res.json(); acks.push({ ...at(), status: res.status(), body }); log('ack-reply', { status: res.status(), id: body.id, ackedAt: body.ackedAt, receipt: body.receipt }); } catch {}
  }
});
page.on('console', (m) => { if (m.type() === 'error') log('console-error', { text: m.text() }); });

const rowIds = () => page.$$eval('[data-testid="incident-row"]', (els) => els.map((e) => e.dataset.id));

// open-board
log('open', { url });
await page.goto(url);
await page.mouse.move(640, 300);
const loaderSeen = await page.locator('[data-testid="loader"]').isVisible().catch(() => false);
log('loader', { visible: loaderSeen });
await page.locator('[data-testid="incident-row"]').first().waitFor();
const sha = await page.getAttribute('meta[name="build"]', 'content');
const footerSha = await page.textContent('[data-testid="build-sha"]');
log('board-loaded', { rows: (await rowIds()).length, top: (await rowIds())[0], loaderGone: (await page.locator('[data-testid="loader"]').count()) === 0, sha, footerSha });
await page.waitForTimeout(2500);

// watch-board: keep it open, no reload, until a new incident shows at the top
const first = await rowIds();
const tWatch = Date.now();
let after = first;
while (Date.now() - tWatch < 180_000) {
  await page.waitForTimeout(500);
  after = await rowIds();
  if (after[0] !== first[0]) break;
}
log('new-at-top', { before: first[0], now: after[0], rows: after.length, newOnTop: after[0] !== first[0] });
await page.waitForTimeout(2000);

// ack-incident: ack the newest incident
const target = (await rowIds())[0];
const btn = page.locator(`[data-testid="incident-row"][data-id="${target}"] [data-testid="ack"]`);
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
await page.waitForTimeout(600);
const idUnderPointer = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id, [box.x + box.width / 2, box.y + box.height / 2]);
log('ack-click', { target, idUnderPointer });
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.locator(`[data-testid="incident-row"][data-id="${target}"] [data-testid="acked"]`).waitFor({ timeout: 10_000 });
log('acked-mark', { target });
await page.waitForTimeout(3000);

// keep watching: the acked row keeps its mark across refreshes
await page.waitForTimeout(6000);
const stillAcked = await page.locator(`[data-testid="incident-row"][data-id="${target}"] [data-testid="acked"]`).count();
log('after-refreshes', { target, stillAcked: stillAcked === 1, rows: (await rowIds()).length });

// the build in the footer
await page.locator('[data-testid="build-sha"]').scrollIntoViewIfNeeded();
await page.mouse.move(200, H - 30, { steps: 10 });
log('footer-sha', { footerSha: await page.textContent('[data-testid="build-sha"]') });
await page.waitForTimeout(3000);

const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), `rec/${name}.webm`);
writeFileSync(`rec/${name}.json`, JSON.stringify({ url, t0: new Date(t0).toISOString(), sha, events, acks }, null, 2));
console.log(`saved rec/${name}.webm and rec/${name}.json`);
