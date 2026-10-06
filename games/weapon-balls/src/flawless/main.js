// The finder page (flawless.html): runs the flawless search (search.js) in Web
// Workers, lists the finds and plays any of them in an arena, or queues it on
// the match API for the display page. A replay is the same seeded match, so it
// plays out exactly as it did in the search.
import './flawless.css';
import { CONFIG } from '../config.js';
import { Game } from '../game/Game.js';
import { Sound } from '../game/Sound.js';
import { WEAPONS, getWeaponById } from '../weapons/index.js';
import { UPGRADES, getUpgradeById } from '../upgrades/index.js';
import { ANY, CHUNK_SIZE, DEFAULTS, MAX_API_TIME_LIMIT, collect, matchRequest, parseEntry, toLoadout } from './search.js';

const byId = (id) => document.getElementById(id);
const ui = {
  form: byId('search-form'),
  fighterRows: byId('fighter-rows'),
  fighterHint: byId('fighter-hint'),
  fighters: byId('fighters'),
  suggestions: byId('fighter-suggestions'),
  idList: byId('id-list'),
  start: byId('start'),
  stop: byId('stop'),
  formError: byId('form-error'),
  progress: byId('progress-fill'),
  status: byId('status'),
  results: byId('results'),
  nowPlaying: byId('now-playing'),
  replay: byId('replay'),
  pause: byId('pause'),
  speed: byId('speed'),
  speedValue: byId('speed-value'),
  sound: byId('sound'),
  hitboxes: byId('hitboxes'),
  toast: byId('toast'),
};

// ---- Viewer -------------------------------------------------------------------

let watching = null; // { find, opts } on screen
const game = new Game(byId('arena'), { chooseMatch: () => watching && replayMatch(watching) });
game.endHint = 'Replay to watch again';
game.newMatch();
game.start();

function replayMatch({ find, opts }) {
  const fighters = find.specs.map(toLoadout);
  return { fighters, seed: find.seed, timeLimit: opts.timeLimit, suddenDeath: opts.suddenDeath };
}

function watch(find, opts) {
  watching = { find, opts };
  game.paused = false;
  game.newMatch();
  ui.replay.disabled = false;
  ui.pause.disabled = false;
  ui.pause.textContent = 'Pause';
  ui.nowPlaying.textContent = `Seed ${find.seed}: ${find.specs.map(fighterName).join(' vs ')}`;
  for (const card of ui.results.children) card.classList.toggle('watching', card.find === find);
}

ui.replay.addEventListener('click', () => watching && watch(watching.find, watching.opts));
ui.pause.addEventListener('click', () => {
  game.paused = !game.paused;
  ui.pause.textContent = game.paused ? 'Resume' : 'Pause';
});
ui.speed.addEventListener('input', () => {
  game.timeScale = Number(ui.speed.value);
  ui.speedValue.textContent = `${game.timeScale}×`;
});
ui.sound.checked = !Sound.muted;
ui.sound.addEventListener('change', () => (Sound.muted = !ui.sound.checked));
ui.hitboxes.addEventListener('change', () => (game.showHitboxes = ui.hitboxes.checked));

// ---- Search -----------------------------------------------------------------------

let search = null; // the running search

// The fighter list: one row per entry, a spec or 'any', each with a must-win box.
function addFighterRow(spec = ANY, mustWin = false) {
  const row = el('li', 'fighter-row');
  const input = el('input', 'spec');
  input.type = 'text';
  input.value = spec;
  input.placeholder = 'any, sword, sword+damage:3+crit...';
  input.setAttribute('list', 'fighter-suggestions');
  input.spellcheck = false;
  const win = el('input', 'must-win');
  win.type = 'checkbox';
  win.checked = mustWin;
  win.title = 'This fighter has to be the one that wins';
  win.setAttribute('aria-label', 'Must win');
  const remove = el('button', 'remove', '×');
  remove.type = 'button';
  remove.title = 'Remove';
  remove.addEventListener('click', () => {
    row.remove();
    updateFighterHint();
  });
  row.append(input, win, remove);
  ui.fighterRows.append(row);
  updateFighterHint();
  return input;
}

function updateFighterHint() {
  const rows = ui.fighterRows.children.length;
  const perMatch = Number(ui.fighters.value) || 2;
  const pick = rows > perMatch ? `Each match picks ${perMatch} of these.` : rows < perMatch ? `Each match fills ${perMatch} places from these, repeating some.` : '';
  ui.fighterHint.textContent = `${pick} 'any' is a random build. A match only counts if a fighter marked must win wins it.`.trim();
}

byId('add-fighter').addEventListener('click', () => addFighterRow('').focus());
ui.fighters.addEventListener('input', updateFighterHint);
ui.suggestions.append(...[ANY, ...WEAPONS.map((W) => W.id)].map((id) => Object.assign(el('option'), { value: id })));
addFighterRow();
addFighterRow();

byId('sudden-death').value = CONFIG.suddenDeath.after ?? '';
ui.idList.append(...idListItems());

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (search) return;
  let opts;
  try {
    opts = readOptions();
  } catch (err) {
    showError(err.message);
    return;
  }
  showError(null);
  startSearch(opts);
});
ui.stop.addEventListener('click', () => search?.finish());

function readOptions() {
  const label = (id) => byId(id).closest('label').querySelector('span').textContent;
  const number = (id, { min = 0, max = Infinity, blank } = {}) => {
    const text = byId(id).value.trim();
    if (text === '' && blank !== undefined) return blank;
    const n = Number(text);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label(id)} must be a number from ${min}${max < Infinity ? ` to ${max}` : ' up'}.`);
    return n;
  };
  const whole = (id, range) => {
    const n = number(id, range);
    if (n !== null && !Number.isInteger(n)) throw new Error(`${label(id)} must be a whole number.`);
    return n;
  };

  const entries = [...ui.fighterRows.children].flatMap((row) => {
    const text = row.querySelector('.spec').value.trim();
    if (!text) return [];
    try {
      const entry = parseEntry(text); // '*sword' marks must-win too
      return [{ ...entry, mustWin: entry.mustWin || row.querySelector('.must-win').checked }];
    } catch (err) {
      throw new Error(`Bad fighter "${text}": ${err.message}.`);
    }
  });
  if (!entries.length) throw new Error('Add at least one fighter.');

  return {
    ...DEFAULTS,
    entries,
    upgrades: whole('upgrades'),
    transformations: whole('transformations'),
    fighters: whole('fighters', { min: 2, max: 12 }),
    count: whole('count', { min: 1 }),
    max: whole('max', { min: 1 }),
    hitsOnly: byId('hits-only').checked,
    timeLimit: number('time-limit', { min: 1, max: MAX_API_TIME_LIMIT }),
    suddenDeath: number('sudden-death', { max: MAX_API_TIME_LIMIT, blank: null }),
    seed: whole('seed', { max: 2 ** 32 - 1, blank: null }) ?? (Math.random() * 2 ** 32) >>> 0,
  };
}

// Hands chunks of match indices to the workers in order, the same way the
// command-line tool does, so a seed finds the same matches in both.
function startSearch(opts) {
  const jobs = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, Math.ceil(opts.max / CHUNK_SIZE)));
  const results = new Map(); // chunk start -> runTask result
  const workers = [];
  const started = performance.now();
  let next = 0;
  let played = 0;
  let running = jobs;
  let stopping = false;
  let shown = -1;

  const finish = () => {
    for (const worker of workers) worker.terminate();
    search = null;
    render(true);
  };

  const render = (done = false) => {
    const { found, closest, played: counted } = collect(results, opts.count);
    const secs = (performance.now() - started) / 1000;
    const rate = Math.round(played / Math.max(secs, 0.001));
    ui.progress.style.width = `${Math.min(100, (played / opts.max) * 100)}%`;
    if (found.length !== shown) {
      shown = found.length;
      showResults(found, opts);
      if (found.length && !watching) watch(found[0], opts);
    }
    if (!done) {
      ui.status.textContent = `${played.toLocaleString()} matches, ${found.length} flawless, ${rate.toLocaleString()}/s (seed ${opts.seed})`;
      return;
    }
    ui.start.disabled = false;
    ui.stop.disabled = true;
    ui.progress.style.width = '100%';
    if (found.length) {
      ui.status.textContent = `Found ${found.length} in ${counted.toLocaleString()} matches (${secs.toFixed(1)}s, seed ${opts.seed}).`;
    } else {
      ui.status.textContent = `No flawless win in ${counted.toLocaleString()} matches (${secs.toFixed(1)}s, seed ${opts.seed}).`;
      if (closest) showResults([closest], opts, `Closest: the winner took ${closest.taken} hit${closest.taken > 1 ? 's' : ''}`);
    }
  };

  search = { finish };
  ui.start.disabled = true;
  ui.stop.disabled = false;
  ui.results.replaceChildren();
  ui.progress.style.width = '0';
  ui.status.textContent = `Searching with ${jobs} workers (seed ${opts.seed})...`;

  for (let i = 0; i < jobs; i++) {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    workers.push(worker);
    const feed = () => {
      if (!stopping && next < opts.max) {
        worker.postMessage({ start: next, count: Math.min(CHUNK_SIZE, opts.max - next), opts });
        next += CHUNK_SIZE;
        return;
      }
      if (--running === 0) finish();
    };
    worker.onmessage = (e) => {
      results.set(e.data.start, e.data);
      played += e.data.count;
      if (collect(results, opts.count).found.length >= opts.count) stopping = true;
      render();
      feed();
    };
    worker.onerror = (e) => {
      showError(`A search worker failed: ${e.message}`);
      finish();
    };
    feed();
  }
}

// ---- Results ------------------------------------------------------------------------

function showResults(finds, opts, heading = null) {
  const cards = finds.map((find, i) => resultCard(find, opts, heading ?? `#${i + 1}`));
  ui.results.replaceChildren(...cards);
  for (const card of cards) card.classList.toggle('watching', card.find === watching?.find);
}

function resultCard(find, opts, heading) {
  const card = el('li', 'result');
  card.find = find;

  const title = el('div', 'result-title');
  title.append(el('strong', '', heading), el('span', 'muted', `seed ${find.seed} · ${find.time.toFixed(1)}s · ${round(find.hp)}/${round(find.maxHp)} HP`));

  const fighters = el('ul', 'fighters');
  find.specs.forEach((spec, i) => {
    const row = el('li', i === find.winner ? 'winner' : '');
    const swatch = el('span', 'swatch');
    swatch.style.background = `hsl(${getWeaponById(parseWeapon(spec)).hue}, 70%, 55%)`;
    row.append(swatch, el('span', '', fighterName(spec)));
    if (find.random[i]) row.append(el('span', 'tag', 'any'));
    if (i === find.winner) row.append(el('span', 'badge', 'winner'));
    row.title = spec;
    fighters.append(row);
  });

  const buttons = el('div', 'buttons');
  const watchButton = el('button', 'primary', 'Watch');
  watchButton.type = 'button';
  watchButton.addEventListener('click', () => watch(find, opts));
  const queueButton = el('button', '', 'Queue on display');
  queueButton.type = 'button';
  queueButton.addEventListener('click', () => queue(find, opts));
  const copyButton = el('button', '', 'Copy JSON');
  copyButton.type = 'button';
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(matchRequest(find, opts)));
    toast('Copied the POST /api/matches body.');
  });
  buttons.append(watchButton, queueButton, copyButton);

  card.append(title, fighters, buttons);
  return card;
}

// Queues the find on this server's match API, for an open ?display page to play.
async function queue(find, opts) {
  try {
    const res = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...matchRequest(find, opts), ref: `flawless/${find.seed}` }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    const status = await fetch('/api/status').then((r) => r.json()).catch(() => null);
    const hint = status && !status.displays ? ' No display is connected yet: open /?display.' : '';
    toast(`Queued as match ${body.id}.${hint}`, { link: !status?.displays });
  } catch (err) {
    toast(`Could not queue it: ${err.message}. Is this page served by npm run dev or npm start?`, { error: true });
  }
}

// ---- Bits -------------------------------------------------------------------------

// 'sword+damage:2+crit' -> 'Sword + Damage x2 + Crit', from the display names.
function fighterName(spec) {
  const [weapon, ...parts] = spec.split('+');
  const names = parts.map((part) => {
    const [id, n] = part.split(':');
    return getUpgradeById(id).displayName + (n ? ` x${n}` : '');
  });
  return [getWeaponById(weapon).displayName, ...names].join(' + ');
}

const parseWeapon = (spec) => spec.split('+')[0];

// The id reference under the fighter list: weapons, then upgrades by who can take them.
function idListItems() {
  const line = (label, ids) => {
    const p = el('p');
    p.append(el('strong', '', `${label}: `), el('code', '', ids.join(', ')));
    return p;
  };
  const items = [line('Weapons', WEAPONS.map((W) => W.id)), line('Any weapon', UPGRADES.filter((U) => U.weapons === null).map((U) => U.id))];
  for (const W of WEAPONS) {
    const own = UPGRADES.filter((U) => U.weapons?.includes(W.id));
    if (own.length) items.push(line(W.displayName, own.map((U) => U.id + (U.transformation ? ' (T)' : ''))));
  }
  const note = el('p', 'muted', "Add upgrades with + and stack them with :N (sword+damage:3+crit). (T) marks a transformation: at most one of each. 'any' is a random build.");
  return [...items, note];
}

let toastTimer = null;
function toast(message, { error = false, link = false } = {}) {
  ui.toast.replaceChildren(message);
  if (link) {
    const a = el('a', '', 'Open the display');
    a.href = '/?display';
    a.target = '_blank';
    ui.toast.append(' ', a);
  }
  ui.toast.classList.toggle('error', error);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), 6000);
}

function showError(message) {
  ui.formError.hidden = !message;
  ui.formError.textContent = message ?? '';
}

const round = (n) => Math.round(n * 10) / 10;

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}
