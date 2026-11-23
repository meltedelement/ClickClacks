import './art.css';
import { CONFIG } from '../config.js';
import { Game } from '../game/Game.js';
import { Renderer } from '../game/Renderer.js';
import { SKIN_IDS } from '../game/skins.js';
import { Ball } from '../sim/Ball.js';
import { UPGRADES, resolveUpgrades } from '../upgrades/index.js';
import { WEAPONS, getWeaponById } from '../weapons/index.js';

// The Art Lab (art.html, dev only): every weapon, transformation and
// combination, drawn by the game's own Renderer so it can't drift from the
// game. The gallery pins each ball in the middle of a small arena and, with
// Animate on, runs its weapon's real update against a stand-in sim with no
// enemies, so spins, timers, heat and the like play as they do in a match.
// The live arena is a real Game against chosen opponents, for everything that
// needs a fight (throws, slams, statuses, effects).

const $ = (id) => document.getElementById(id);
const GALLERY_ARENA = 380; // arena units across a gallery card, at size 1

// ---- State, kept in the URL hash so a view can be reloaded or shared ----------

const state = loadState();

function loadState() {
  const params = new URLSearchParams(location.hash.slice(1));
  const weapon = WEAPONS.some((W) => W.id === params.get('weapon')) ? params.get('weapon') : WEAPONS[0].id;
  const picks = (params.get('build') ?? '').split(',').filter((id) => UPGRADES.some((U) => U.id === id));
  return {
    weapon,
    picks, // upgrade ids in pick order; an id repeats for each stack
    color: params.get('color') || null, // null: the weapon's own
    skin: params.get('skin') || null,
    size: Number(params.get('size')) || 1,
    tab: params.get('tab') === 'live' ? 'live' : 'gallery',
  };
}

function saveState() {
  const params = new URLSearchParams();
  params.set('weapon', state.weapon);
  if (state.picks.length) params.set('build', state.picks.join(','));
  if (state.color) params.set('color', state.color);
  if (state.skin) params.set('skin', state.skin);
  if (state.size !== 1) params.set('size', String(state.size));
  if (state.tab !== 'gallery') params.set('tab', state.tab);
  history.replaceState(null, '', `#${params}`);
}

function changed() {
  saveState();
  renderControls();
  buildGallery();
  if (live.game) live.restart();
}

// ---- Loadouts ----------------------------------------------------------------

const Weapon = () => getWeaponById(state.weapon);
const transformationsFor = (id) => UPGRADES.filter((U) => U.transformation && U.canApplyTo(id));
const upgradesFor = (id) => UPGRADES.filter((U) => !U.transformation && U.canApplyTo(id));
const isTransformation = (id) => UPGRADES.find((U) => U.id === id)?.transformation ?? false;
const nameOf = (id) => UPGRADES.find((U) => U.id === id)?.displayName ?? id;
const defaultColor = (W) => hslToHex(W.hue, 70, 55);

function loadout(upgrades) {
  return {
    weapon: state.weapon,
    upgrades,
    color: state.color ?? defaultColor(Weapon()),
    skin: state.skin,
    size: state.size,
  };
}

// weapon+id+id:2, the fighter spec the balance and flawless tools take.
function specOf(weapon, upgrades) {
  const counts = new Map();
  for (const id of upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [weapon, ...[...counts].map(([id, n]) => (n > 1 ? `${id}:${n}` : id))].join('+');
}

// ---- Controls ----------------------------------------------------------------

function renderControls() {
  const W = Weapon();
  $('weapons').replaceChildren(
    ...WEAPONS.map((V) =>
      chip(V.displayName, V.id === state.weapon, () => {
        if (V.id === state.weapon) return;
        state.weapon = V.id;
        state.picks = [];
        changed();
      }),
    ),
  );

  const transformations = state.picks.filter(isTransformation);
  $('transformations').replaceChildren(
    ...transformationsFor(W.id).map((U) => {
      const at = transformations.indexOf(U.id);
      const el = chip(U.displayName, at >= 0, () => {
        state.picks = at >= 0 ? state.picks.filter((id) => id !== U.id) : [...state.picks, U.id];
        changed();
      });
      el.title = U.description;
      if (at >= 0) el.append(badge('order', at + 1));
      return el;
    }),
  );

  $('upgrades').replaceChildren(
    ...upgradesFor(W.id).map((U) => {
      const count = state.picks.filter((id) => id === U.id).length;
      const el = chip(U.displayName, count > 0, (event) => {
        // Click adds a copy; shift-click or right-click takes one off.
        if (event.shiftKey || event.type === 'contextmenu') {
          const at = state.picks.lastIndexOf(U.id);
          if (at < 0) return;
          state.picks = state.picks.filter((_, i) => i !== at);
        } else {
          if (count >= U.maxStacks) return;
          state.picks = [...state.picks, U.id];
        }
        changed();
      });
      el.title = `${U.description}\nClick to add a copy, right-click or shift-click to remove one.`;
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        el.onclick(event);
      });
      if (count > 1) el.append(badge('count', `×${count}`));
      return el;
    }),
  );

  $('color').value = state.color ?? defaultColor(W);
  $('skin').value = state.skin ?? '';
  $('size').value = String(state.size);
  $('size-value').textContent = String(state.size);
  $('spec').textContent = specOf(W.id, state.picks);
}

function chip(text, on, onClick) {
  const el = document.createElement('button');
  el.className = on ? 'chip on' : 'chip';
  el.textContent = text;
  el.onclick = onClick;
  return el;
}

function badge(kind, text) {
  const el = document.createElement('span');
  el.className = kind;
  el.textContent = text;
  return el;
}

$('skin').replaceChildren(new Option('None', ''), ...SKIN_IDS.map((id) => new Option(id, id)));
$('opponent').replaceChildren(...WEAPONS.map((W) => new Option(W.displayName, W.id)));
$('clear').onclick = () => {
  state.picks = [];
  changed();
};
$('color').oninput = (event) => {
  state.color = event.target.value;
  changed();
};
$('color-reset').onclick = () => {
  state.color = null;
  changed();
};
$('skin').onchange = (event) => {
  state.skin = event.target.value || null;
  changed();
};
$('size').oninput = (event) => {
  state.size = Number(event.target.value);
  changed();
};
$('card-size').oninput = (event) => $('gallery').style.setProperty('--card', `${event.target.value}px`);
$('gallery').style.setProperty('--card', `${$('card-size').value}px`);
$('all-pairs').onchange = () => buildGallery();

// ---- Gallery -----------------------------------------------------------------

let cards = [];
const visible = new IntersectionObserver((entries) => {
  for (const entry of entries) entry.target.card.visible = entry.isIntersecting;
});

function buildGallery() {
  for (const card of cards) {
    card.renderer.destroy();
    visible.unobserve(card.el);
  }
  cards = [];
  const gallery = $('gallery');
  gallery.replaceChildren();

  const W = Weapon();
  const picks = state.picks;
  const own = picks.filter(isTransformation);
  const extras = picks.filter((id) => !isTransformation(id)); // the build's ordinary upgrades
  const all = transformationsFor(W.id).map((U) => U.id);
  const withExtras = extras.length ? ` + ${extras.length} upgrade${extras.length > 1 ? 's' : ''}` : '';

  if (picks.length) group('Your build', [{ title: specOf(W.id, picks), upgrades: picks }]);
  group(`Each transformation${withExtras}`, [
    { title: `Plain ${W.displayName}${withExtras}`, upgrades: extras },
    ...all.map((id) => ({ title: nameOf(id) + withExtras, upgrades: [id, ...extras] })),
  ]);
  if (own.length) {
    const others = all.filter((id) => !own.includes(id));
    group(
      'Your build + one more',
      others.map((id) => ({ title: `+ ${nameOf(id)}`, upgrades: [...picks, id] })),
    );
  }
  if ($('all-pairs').checked) {
    const pairs = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        pairs.push({ title: `${nameOf(all[i])} + ${nameOf(all[j])}`, upgrades: [all[i], all[j], ...extras] });
      }
    }
    group(`Every pair (first named is picked first)${withExtras}`, pairs);
  }

  function group(title, specs) {
    if (!specs.length) return;
    const section = document.createElement('section');
    section.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'cards';
    for (const spec of specs) grid.append(makeCard(spec));
    section.append(heading, grid);
    gallery.append(section);
  }
}

function makeCard({ title, upgrades }) {
  const el = document.createElement('div');
  el.className = 'card';
  const canvas = document.createElement('canvas');
  const label = document.createElement('div');
  label.className = 'title';
  label.textContent = title;
  el.append(canvas, label);
  el.title = 'Click to make this the build';
  el.onclick = () => {
    state.picks = [...upgrades];
    changed();
  };

  const card = { el, renderer: new Renderer(canvas), sim: null, ball: null, visible: false, broken: false };
  el.card = card;
  try {
    card.sim = standInSim(loadout(upgrades));
    card.ball = card.sim.balls[0];
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = error.message;
    el.append(message);
  }
  cards.push(card);
  visible.observe(el);
  return el;
}

// Just enough of a Simulation for the Renderer and a weapon's update: one ball,
// no enemies, and nothing it does to anyone lands.
function standInSim(fighter) {
  const size = fighter.size;
  const side = GALLERY_ARENA * size;
  const arena = { width: side, height: side };
  const W = getWeaponById(fighter.weapon);
  const ball = new Ball({
    position: { x: side / 2, y: side / 2 },
    color: fighter.color,
    WeaponClass: W,
    upgrades: resolveUpgrades(fighter.upgrades, W.id),
    skin: fighter.skin,
    size,
    arena,
  });
  ball.vel = { x: 0, y: 0 };
  const balls = [ball];
  return {
    arena,
    balls,
    aliveBalls: balls,
    royale: false,
    over: false,
    winner: null,
    time: 0,
    inSuddenDeath: false,
    onEvent() {},
    dealDamage() {},
    applyHit() {},
    applySecondaryHit() {
      return 0;
    },
  };
}

const NO_EFFECTS = { shakeOffset: () => ({ x: 0, y: 0 }), draw() {}, update() {} };
let lastFrame = null;

function galleryFrame(now) {
  requestAnimationFrame(galleryFrame);
  const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if ($('gallery').hidden) return;
  const animate = $('animate').checked;
  for (const card of cards) {
    if (!card.visible || !card.sim) continue;
    if (animate && dt > 0) tick(card, dt);
    card.renderer.draw(card.sim, NO_EFFECTS);
  }
}

// One step of the weapon's own update, then the ball is put back in the middle.
// A weapon whose update needs more of a sim than the stand-in has just spins.
function tick(card, dt) {
  const { sim, ball } = card;
  sim.time += dt;
  if (!card.broken) {
    try {
      ball.update(dt, sim);
    } catch (error) {
      card.broken = true;
      console.warn(`Art Lab: ${card.el.textContent} can't run its update here, so it only spins`, error);
    }
  } else {
    ball.weapon.angle += ball.weapon.spinSpeed * ball.weapon.spinDir * dt;
  }
  ball.pos.x = sim.arena.width / 2;
  ball.pos.y = sim.arena.height / 2;
  ball.vel.x = 0;
  ball.vel.y = 0;
}

// ---- Live arena --------------------------------------------------------------

const live = {
  game: null,
  start() {
    const canvas = $('arena');
    canvas.parentElement.style.setProperty('--aspect', `${CONFIG.arena.width / CONFIG.arena.height}`);
    if (!this.game) {
      this.game = new Game(canvas, { chooseMatch: () => this.match(), soundKey: 'art-lab' });
      this.game.endHint = 'R to restart';
      this.game.autoRematch = true;
      this.applySettings();
      this.game.newMatch();
    }
    this.game.start();
  },
  stop() {
    this.game?.stop();
  },
  restart() {
    this.game?.newMatch();
  },
  match() {
    const fighters = [loadout(state.picks)];
    const count = Math.max(1, Math.min(8, Number($('opponents').value) || 1));
    for (let i = 0; i < count; i++) fighters.push({ weapon: $('opponent').value });
    // A size only takes in a royale (see Ball.grow).
    return { fighters, royale: state.size !== 1, suddenDeath: $('endless').checked ? null : undefined };
  },
  applySettings() {
    const { game } = this;
    if (!game) return;
    game.timeScale = Number($('speed').value);
    game.showHitboxes = $('hitboxes').checked;
    game.sound.muted = !$('sound').checked;
  },
};

// Endless: everyone's HP is topped up every frame, so nothing dies.
function keepAlive() {
  requestAnimationFrame(keepAlive);
  const sim = live.game?.sim;
  if (!sim || !$('endless').checked) return;
  for (const ball of sim.balls) if (ball.alive) ball.hp = ball.maxHp;
}

for (const id of ['speed', 'hitboxes', 'sound']) $(id).onchange = () => live.applySettings();
for (const id of ['opponent', 'opponents', 'endless']) $(id).onchange = () => live.restart();
$('restart').onclick = () => live.restart();
$('pause').onclick = () => togglePause();
$('step').onclick = () => step();

function togglePause() {
  if (!live.game) return;
  live.game.paused = !live.game.paused;
  $('pause').textContent = live.game.paused ? 'Play' : 'Pause';
}

function step() {
  const { game } = live;
  if (!game?.sim) return;
  if (!game.paused) togglePause();
  game.stepSim();
  game.effects.update(game.fixedDt);
}

document.addEventListener('keydown', (event) => {
  if ($('live').hidden || event.target.matches('input, select')) return;
  if (event.key === ' ') {
    event.preventDefault();
    togglePause();
  } else if (event.key === '.') step();
  else if (event.key === 'r' || event.key === 'R') live.restart();
});

// ---- Tabs --------------------------------------------------------------------

function showTab(tab) {
  state.tab = tab;
  saveState();
  for (const button of document.querySelectorAll('.tabs button')) button.classList.toggle('active', button.dataset.tab === tab);
  $('gallery').hidden = tab !== 'gallery';
  $('live').hidden = tab !== 'live';
  if (tab === 'live') live.start();
  else live.stop();
}

for (const button of document.querySelectorAll('.tabs button')) button.onclick = () => showTab(button.dataset.tab);

// ---- Helpers -----------------------------------------------------------------

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

renderControls();
buildGallery();
showTab(state.tab);
requestAnimationFrame(galleryFrame);
requestAnimationFrame(keepAlive);
