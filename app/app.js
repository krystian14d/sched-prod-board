import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = board.querySelector('[data-testid="incident-list"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const errorBox = board.querySelector('.error');
const status = document.querySelector('.status');

// R5: the viewer's own zone and locale order (en-GB, de, pl … → day before month; en-US → month first).
const localTime = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const rows = new Map(); // incident id → <li>, so a refresh never rebuilds rows that are already there
const acked = new Set();

function rowFor(i) {
  const li = document.createElement('li');
  li.dataset.testid = 'incident-row';
  li.dataset.id = i.id;
  li.className = `row ${i.severity}`;

  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = i.id;
  const sev = document.createElement('span');
  sev.className = 'sev';
  sev.textContent = i.severity;
  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = `${i.service} · ${i.region} · ${i.summary}`; // text, never HTML
  const time = document.createElement('time');
  time.dateTime = i.openedAt; // full UTC value stays in the attribute
  time.textContent = localTime.format(new Date(i.openedAt));
  time.title = `${i.openedAt} (UTC)`;

  const act = document.createElement('span');
  act.className = 'act';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.testid = 'ack';
  btn.textContent = 'Ack';
  btn.addEventListener('click', () => onAck(i.id, btn, act));
  act.append(btn);

  li.append(id, sev, what, time, act);
  return li;
}

function markAcked(act) {
  const mark = document.createElement('span');
  mark.dataset.testid = 'acked';
  mark.className = 'acked';
  mark.textContent = '✓ acked';
  act.replaceChildren(mark);
}

async function onAck(id, btn, act) {
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    await ack(id); // R2 — api.js sends the latest cursor and keeps the receipt
    acked.add(id);
    markAcked(act);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ack';
    showError(err);
  }
}

// R1: rows the board has not seen yet go in at the top, newest first; existing rows stay as they are.
function render(incidents) {
  const ids = new Set(incidents.map((i) => i.id));
  for (const [id, li] of rows) {
    if (!ids.has(id)) {
      li.remove();
      rows.delete(id);
    }
  }
  let prev = null;
  for (const i of incidents) {
    let li = rows.get(i.id);
    if (!li) {
      li = rowFor(i);
      rows.set(i.id, li);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (li !== want) list.insertBefore(li, want);
    prev = li;
  }
  list.hidden = incidents.length === 0;
  empty.hidden = incidents.length !== 0;
}

function showError(err) {
  errorBox.textContent = `Could not reach the incident API: ${err.message}`;
  errorBox.hidden = false;
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    loader.remove(); // R3: gone once incidents are on screen
    errorBox.hidden = true;
    status.textContent = `updated ${localTime.format(new Date(page.updatedAt))}`;
  } catch (err) {
    showError(err);
  } finally {
    setTimeout(refresh, REFRESH_MS); // R4: every 2 s; never two requests in flight
  }
}

refresh();
