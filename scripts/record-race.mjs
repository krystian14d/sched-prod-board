// Records the ack race the way a person meets it: on-call aims at a row's Ack, a new incident lands at the
// top while the pointer is on the way, and the click goes where the hand already was.
// Usage: node scripts/record-race.mjs <board url> <out name> [row index to aim at, default 1]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

const [url, name = 'race', aimIndexArg = '1'] = process.argv.slice(2);
if (!url) throw new Error('usage: node scripts/record-race.mjs <board url> <out name> [row index]');
const aimIndex = Number(aimIndexArg);
mkdirSync('rec', { recursive: true });

const W = 1280, H = 820;
const REACTION_MS = 180; // a click already on its way when the list moves
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  locale: 'en-GB',
  timezoneId: 'Europe/Warsaw',
  recordVideo: { dir: 'rec/tmp', size: { width: W, height: H } },
});

await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,80,.55);border:2px solid #fff;box-shadow:0 0 0 1px #c00;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.8)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
    // Note when a row is added at the top of the list (for the log only; the board does not see this).
    window.__inserts = [];
    const list = document.querySelector('[data-testid="incident-list"]');
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.dataset?.testid === 'incident-row' && list.firstElementChild === n) window.__inserts.push({ id: n.dataset.id, t: Date.now() });
    }).observe(list, { childList: true });
  });
});

const page = await context.newPage();
const t0 = Date.now();
const mmss = (ms) => { const s = Math.max(0, (ms - t0) / 1000); return { s: +s.toFixed(2), mmss: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` }; };
const events = [];
const log = (what, extra = {}, when = Date.now()) => { const e = { ...mmss(when), what, ...extra }; events.push(e); console.log(JSON.stringify(e)); };

const acks = [];
page.on('response', async (res) => {
  if (res.url().includes('/ack?')) {
    try { const body = await res.json(); acks.push({ ...mmss(Date.now()), status: res.status(), body }); log('ack-reply', { status: res.status(), id: body.id, ackedAt: body.ackedAt, receipt: body.receipt }); } catch {}
  }
});
const rowIds = () => page.$$eval('[data-testid="incident-row"]', (els) => els.map((e) => e.dataset.id));

log('open', { url });
await page.goto(url);
await page.mouse.move(700, 420);
await page.locator('[data-testid="incident-row"]').first().waitFor();
const sha = await page.getAttribute('meta[name="build"]', 'content');
log('board-loaded', { rows: await rowIds(), sha });

let result = null;
for (let attempt = 1; attempt <= 6 && !result; attempt++) {
  // Look, pick a row, move toward its Ack.
  const ids = await rowIds();
  const meant = ids[aimIndex];
  const btn = page.locator(`[data-testid="incident-row"][data-id="${meant}"] [data-testid="ack"]`);
  const box = await btn.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const before = await page.evaluate(() => window.__inserts.length);
  log('aim', { attempt, meant, rowIndex: aimIndex, at: [Math.round(x), Math.round(y)] });
  await page.mouse.move(x, y, { steps: 12 });
  // The hand is there; the click goes as soon as on-call decides — here, when the page next changes.
  const deadline = Date.now() + 30_000;
  let ins = null;
  while (Date.now() < deadline) {
    const all = await page.evaluate(() => window.__inserts);
    if (all.length > before) { ins = all[all.length - 1]; break; }
    await page.waitForTimeout(25);
  }
  if (!ins) { log('no-insert', { attempt }); await page.mouse.move(700, 420, { steps: 5 }); continue; }
  log('incident-landed', { id: ins.id }, ins.t);
  await page.waitForTimeout(Math.max(0, REACTION_MS - (Date.now() - ins.t)));
  const under = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="incident-row"]')?.dataset.id, [x, y]);
  const tClick = Date.now();
  await page.mouse.click(x, y);
  log('click', { meant, rowUnderPointer: under, msAfterLanding: tClick - ins.t }, tClick);
  await page.waitForTimeout(1500);
  const ackedRows = await page.$$eval('[data-testid="acked"]', (els) => els.map((e) => e.closest('[data-testid="incident-row"]').dataset.id));
  result = { meant, landed: ins.id, rowUnderPointer: under, ackedRows, clickAt: mmss(tClick), landedAt: mmss(ins.t) };
  log('result', result);
}

await page.mouse.move(400, 600, { steps: 10 });
await page.waitForTimeout(4000);
await page.locator('[data-testid="build-sha"]').scrollIntoViewIfNeeded();
log('footer-sha', { footerSha: await page.textContent('[data-testid="build-sha"]') });
await page.waitForTimeout(2500);

const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), `rec/${name}.webm`);
writeFileSync(`rec/${name}.json`, JSON.stringify({ url, t0: new Date(t0).toISOString(), sha, result, events, acks }, null, 2));
console.log(`saved rec/${name}.webm and rec/${name}.json`);
