// Headless benchmark for the browser-side game loop: Game -> Effects -> Renderer.
//
// There is no real rasteriser in Node, so this measures the CPU side of drawing:
// how many Canvas 2D calls each frame makes (the dominant cost per particle is
// one beginPath + arc + fill) and how many milliseconds the JS loop takes. Use it
// to compare before/after when tuning effects load, especially with several
// display screens running at once.
//
//   node tools/bench-render.js [--screens=4] [--seconds=20] [--seed=42] [--json]
//                              [--fighters=2] [--storm=N] [--quality=N]
//                              [--mode=display] [--visible=N] [--match-seconds=S]
//                              [--royale=N]
//
// --storm=N spawns N synthetic sparks per screen per frame, to measure the
// effects path on its own. --quality=N pins a quality level (0 high .. 3 minimal)
// with the adaptive controller off. --mode=display benchmarks the real display
// page through TournamentDisplay, with the server filling only --visible screens.
// Particle/op counts are deterministic for a given seed; timings are not, so run
// with the machine otherwise idle.

import { mulberry32 } from '../src/sim/random.js';
import { WEAPONS } from '../src/weapons/index.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const SCREENS = Number(args.get('screens') ?? 4);
const SECONDS = Number(args.get('seconds') ?? 20);
const SEED = Number(args.get('seed') ?? 42);
const FIGHTERS = Number(args.get('fighters') ?? 2);
// --royale=N plays royales of N balls (every weapon in turn) instead of --fighters.
const ROYALE = args.has('royale') ? Number(args.get('royale')) || 100 : 0;
const STORM = Number(args.get('storm') ?? 0);
const QUALITY = args.has('quality') ? Number(args.get('quality')) : null;
const MODE = args.get('mode') ?? 'games'; // 'games' = N live arenas, 'display' = the real display page
const VISIBLE = Number(args.get('visible') ?? SCREENS); // display mode: screens the server fills
const MATCH_SECONDS = Number(args.get('match-seconds') ?? 15); // display mode: when a fresh round starts
const AS_JSON = args.get('json') === 'true';
const FPS = 60;
const FRAME_MS = 1000 / FPS;

// ---- Canvas 2D stub that counts calls ---------------------------------------

// Every CanvasRenderingContext2D method the game calls. Keeping the list
// explicit (rather than proxying everything) means a drawing change that uses a
// method this stub doesn't know fails loudly here instead of silently.
const CTX_METHODS = [
  'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'fillText', 'strokeText', 'measureText', 'drawImage', 'setLineDash',
  'createLinearGradient', 'createRadialGradient', 'createPattern',
];

class CountingContext {
  constructor() {
    this.counts = Object.create(null);
    for (const name of CTX_METHODS) this.counts[name] = 0;
    this.ops = 0;
    this.globalAlpha = 1;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.lineDashOffset = 0;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
  }
}

// State like fillStyle/globalAlpha is a plain data property here, the way a real
// context keeps it. (Counting those writes through accessors cost more than the
// drawing and swamped everything else in an earlier version of this harness.)
for (const name of CTX_METHODS) {
  if (name.startsWith('create')) {
    CountingContext.prototype[name] = function () {
      this.counts[name]++;
      this.ops++;
      return { addColorStop() {} };
    };
  } else if (name === 'measureText') {
    CountingContext.prototype[name] = function () {
      this.counts[name]++;
      this.ops++;
      return { width: 10 };
    };
  } else {
    CountingContext.prototype[name] = function () {
      this.counts[name]++;
      this.ops++;
    };
  }
}

const CANVAS_CSS_SIZE = { width: 640, height: 640 };

class FakeCanvas {
  constructor() {
    this.width = CANVAS_CSS_SIZE.width;
    this.height = CANVAS_CSS_SIZE.height;
    this.ctx = new CountingContext();
  }

  getContext() {
    return this.ctx;
  }

  getBoundingClientRect() {
    return { width: CANVAS_CSS_SIZE.width, height: CANVAS_CSS_SIZE.height, top: 0, left: 0 };
  }

  addEventListener() {}
  removeEventListener() {}
  append() {}
}

// ---- Minimal DOM/browser globals --------------------------------------------

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.attrs = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
    this.hidden = false;
  }

  setAttribute(k, v) {
    this.attrs[k] = v;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener() {}
  querySelector() {
    return new FakeNode();
  }
}

let rafQueue = [];
let nextRafId = 1;
const cancelledRaf = new Set();
// The benchmark clock, in ms. It is what requestAnimationFrame passes and what
// performance.now() reports, so timers inside the game see bench time.
let now = 0;

globalThis.window = {
  devicePixelRatio: 2,
  addEventListener() {},
  removeEventListener() {},
  location: { search: '' },
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? new FakeCanvas() : new FakeNode(tag)),
  querySelector: () => new FakeNode(),
  getElementById: () => new FakeCanvas(),
  addEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.EventSource = class {
  constructor() {}
  addEventListener() {}
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
globalThis.requestAnimationFrame = (fn) => {
  const id = nextRafId++;
  rafQueue.push({ id, fn });
  return id;
};
globalThis.cancelAnimationFrame = (id) => cancelledRaf.add(id);
globalThis.performance = { now: () => now };

// Seed everything, including the "real" random Game captures at import time.
Math.random = mulberry32(SEED);

const { Game } = await import('../src/game/Game.js');
// Quality.js only exists after the adaptive-quality change. Falling back keeps
// this harness usable for before/after runs across that commit.
const { Quality } = await import('../src/game/Quality.js').catch(() => ({
  Quality: { enabled: false, level: 0, profile: { resolutionScale: 1, particleBudget: Infinity, effectScale: 1 } },
}));

if (QUALITY !== null) {
  Quality.enabled = false;
  Quality.level = QUALITY;
}

// ---- Scenario -----------------------------------------------------------------

// Loadouts that generate a lot of effects: transformations emit bursts on
// abilities and hits, fire-eater keeps a drawing status up, and multi-ball
// screens multiply the event volume.
const LOADOUTS = [
  { weapon: 'sword', name: 'ALPHA', color: '#e5484d', upgrades: ['fire-eater', 'dizzy', 'captain', 'lifesteal'] },
  { weapon: 'sword', name: 'BRAVO', color: '#4d8ce5', upgrades: ['piercer', 'wildling', 'thorns', 'crit'] },
  { weapon: 'spear', name: 'CHARLIE', color: '#e5c04d', upgrades: ['hoplite', 'tackler', 'dancer', 'health'] },
  { weapon: 'mace', name: 'DELTA', color: '#4de58c', upgrades: ['portaler', 'kamikaze', 'pilot', 'armor'] },
  { weapon: 'daggers', name: 'ECHO', color: '#c04de5', upgrades: ['rogue', 'trickster', 'saw', 'multidexterous'] },
];

let matchId = 0;
function matchFor(screen, id) {
  if (ROYALE) {
    const fighters = Array.from({ length: ROYALE }, (_, j) => ({ weapon: WEAPONS[(screen + j) % WEAPONS.length].id }));
    return { id: id ?? matchId++, seed: SEED + matchId, fighters, royale: true };
  }
  const fighters = Array.from({ length: FIGHTERS }, (_, j) => LOADOUTS[(screen + j) % LOADOUTS.length]);
  return { id: id ?? matchId++, seed: SEED + matchId, fighters, timeLimit: 12, tiebreak: 'hp' };
}

let games = [];
let refresh = () => {};

if (MODE === 'display') {
  // The real display page: TournamentDisplay owns four screens (each its own
  // Game + canvas) and the server fills only the first `visible` of them.
  const { TournamentDisplay } = await import('../src/ui/TournamentDisplay.js');
  const display = new TournamentDisplay(new FakeNode('div'));
  games = display.games;
  display.receive(Array.from({ length: SCREENS }, (_, i) => (i < VISIBLE ? matchFor(i) : null)));
  await new Promise((resolve) => setTimeout(resolve, 0)); // Screen.receive shows matches on a timer
  // A fresh round on the screens that are in use, the way the server feeds them.
  // (Screen.show directly: the result-pause timer is real-time based.)
  refresh = () => {
    for (let i = 0; i < VISIBLE; i++) display.screens[i].show(matchFor(i));
  };
} else {
  // `screens` independent arenas, every one with a match from the start.
  for (let i = 0; i < SCREENS; i++) {
    const game = new Game(new FakeCanvas(), {
      chooseMatch: () => matchFor(i),
      soundKey: `bench-${i}`,
    });
    game.autoRematch = true;
    game.newMatch();
    game.start();
    games.push(game);
  }
}

// ---- Drive frames -------------------------------------------------------------

const totalFrames = Math.round(SECONDS * FPS);
const refreshEvery = Math.round(MATCH_SECONDS * FPS);
const perGameTime = new Float64Array(totalFrames);
const frameTime = new Float64Array(totalFrames);
const particleSeries = new Int32Array(totalFrames);
const peak = { particles: 0, opsInFrame: 0 };

for (let f = 0; f < totalFrames; f++) {
  now += FRAME_MS;
  if (refreshEvery > 0 && f > 0 && f % refreshEvery === 0) refresh();
  if (STORM > 0) {
    for (const g of games) {
      g.effects.burst({ x: 100 + Math.random() * 250, y: 100 + Math.random() * 250 }, '#ffd23f', { count: STORM, speed: 200, life: 0.6, size: 3 });
      g.effects.floatingText({ x: 200, y: 200 }, '-12', '#ffffff');
    }
  }
  const callbacks = rafQueue;
  rafQueue = [];
  const frameStart = process.hrtime.bigint();
  let particles = 0;
  for (let i = 0; i < callbacks.length; i++) {
    const { id, fn } = callbacks[i];
    if (cancelledRaf.delete(id)) continue; // a stopped game's pending frame
    const t0 = process.hrtime.bigint();
    fn(now);
    perGameTime[f] += Number(process.hrtime.bigint() - t0) / 1e6;
  }
  frameTime[f] = Number(process.hrtime.bigint() - frameStart) / 1e6;
  for (const g of games) {
    particles += g.effects.particles.length + g.effects.texts.length;
    peak.particles = Math.max(peak.particles, g.effects.particles.length);
    peak.opsInFrame = Math.max(peak.opsInFrame, g.renderer.ctx.ops);
  }
  particleSeries[f] = particles;
  for (const g of games) g.renderer.ctx.ops = 0;
}

// ---- Report -------------------------------------------------------------------

const sorted = [...frameTime].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const avgParticles = mean([...particleSeries]);
const maxParticles = Math.max(...particleSeries);

const counts = Object.create(null);
for (const g of games) {
  for (const [k, v] of Object.entries(g.renderer.ctx.counts)) counts[k] = (counts[k] ?? 0) + v;
}

const result = {
  mode: MODE,
  screens: SCREENS,
  visible: MODE === 'display' ? VISIBLE : SCREENS,
  seconds: SECONDS,
  seed: SEED,
  frames: totalFrames,
  storm: STORM,
  qualityLevel: QUALITY ?? Quality.level,
  frameMs: { mean: +mean(frameTime).toFixed(3), p50: +pct(0.5).toFixed(3), p95: +pct(0.95).toFixed(3), p99: +pct(0.99).toFixed(3), max: +Math.max(...frameTime).toFixed(3) },
  simAndDrawMsPerFrame: +mean(perGameTime).toFixed(3),
  particles: { avgTotal: +avgParticles.toFixed(1), maxTotal: maxParticles, maxPerScreen: peak.particles },
  droppedParticlesPerFrame: +(games.reduce((s, g) => s + g.effects.dropped, 0) / totalFrames).toFixed(1),
  // Only screens that actually run: stopped display cells draw nothing.
  backingPixels: games.filter((g) => g.running).reduce((s, g) => s + g.renderer.canvas.width * g.renderer.canvas.height, 0),
  canvasOpsPerFrameAvg: +(Object.values(counts).reduce((s, v) => s + v, 0) / totalFrames).toFixed(1),
  canvasOpsPerFramePeak: peak.opsInFrame,
  perOpPerFrame: Object.fromEntries(
    Object.entries(counts)
      .map(([k, v]) => [k, +(v / totalFrames).toFixed(1)])
      .filter(([, v]) => v >= 0.5)
      .sort((a, b) => b[1] - a[1]),
  ),
};

if (AS_JSON) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`mode=${result.mode} screens=${result.screens} visible=${result.visible} frames=${result.frames} seed=${result.seed} storm=${result.storm} quality=${result.qualityLevel}`);
  console.log(`frame ms: mean ${result.frameMs.mean} p50 ${result.frameMs.p50} p95 ${result.frameMs.p95} p99 ${result.frameMs.p99} max ${result.frameMs.max}`);
  console.log(`loop ms/frame (all running screens): ${result.simAndDrawMsPerFrame}`);
  console.log(`particles: avg ${result.particles.avgTotal} max ${result.particles.maxTotal} (max/screen ${result.particles.maxPerScreen}), dropped ${result.droppedParticlesPerFrame}/frame`);
  console.log(`backing pixels (running screens): ${(result.backingPixels / 1e6).toFixed(2)}M`);
  console.log(`canvas ops/frame: avg ${result.canvasOpsPerFrameAvg} peak ${result.canvasOpsPerFramePeak}`);
  console.log('top ops/frame:');
  for (const [k, v] of Object.entries(result.perOpPerFrame).slice(0, 18)) console.log(`  ${k.padEnd(22)} ${v}`);
}
