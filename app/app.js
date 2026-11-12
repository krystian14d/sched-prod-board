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

// R1 (changed by product, step 2): the list holds still while it is on screen. Incidents the board has
// not shown yet wait in `pending`; the "N new" bar brings them in at the top, newest first, on click.
// Rows already on screen are never moved or removed by a refresh.
const pending = new Map(); // id → incident, newest first
const newBar = board.querySelector('[data-testid="new-bar"]');

function insertAtTop(incidents) {
  // incidents are newest first; the newest ends up on top
  for (let k = incidents.length - 1; k >= 0; k--) {
    const i = incidents[k];
    const li = rowFor(i);
    rows.set(i.id, li);
    list.insertBefore(li, list.firstChild);
  }
}

function render(incidents) {
  const unseen = incidents.filter((i) => !rows.has(i.id));
  if (rows.size === 0) {
    insertAtTop(unseen); // nothing on screen yet, so nothing can move
  } else {
    for (const i of unseen) if (!pending.has(i.id)) pending.set(i.id, i);
  }
  showBar();
  list.hidden = rows.size === 0;
  empty.hidden = rows.size !== 0;
}

function showBar() {
  const n = pending.size;
  newBar.textContent = n === 1 ? '1 new incident — show' : `${n} new incidents — show`;
  newBar.classList.toggle('on', n > 0); // the bar's slot is always there, so it never pushes the list down
  newBar.disabled = n === 0;
}

newBar.addEventListener('click', () => {
  if (!pending.size) return;
  const incoming = [...pending.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  pending.clear();
  insertAtTop(incoming);
  showBar();
  list.hidden = false;
  empty.hidden = true;
});

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
