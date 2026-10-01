// A display page without a browser: connects to the match API as a display,
// plays every match put on a screen with the real sim (seeded the same way as
// src/game/Game.js), and posts each result back. For testing a tournament
// driver, or the tournament service, without opening ?display.
//
//   node tools/headless-display.js                           # the game on http://127.0.0.1:3002
//   node tools/headless-display.js --game=http://127.0.0.1:5173 --delay=2000
//
// --delay is how long (ms) each match "plays" before its result is sent.
// Results match a browser display, except that JavaScript engines can differ
// in the last bit of some math functions (see the README's Match API section).
import { CONFIG } from '../src/config.js';
import { Simulation } from '../src/sim/Simulation.js';
import { mulberry32 } from '../src/sim/random.js';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const GAME = arg('game', 'http://127.0.0.1:3002').replace(/\/+$/, '');
const DELAY = Number(arg('delay', 300));
const DT = 1 / CONFIG.physicsHz;

const played = new Set(); // match ids already played or being played

function play(match) {
  const realRandom = Math.random;
  Math.random = mulberry32(match.seed);
  try {
    const fighters = match.fighters.map(({ transformations = [], upgrades = [], ...fighter }) => ({ ...fighter, upgrades: [...transformations, ...upgrades] }));
    const sim = new Simulation(fighters, { tiebreak: match.tiebreak, suddenDeath: match.suddenDeath });
    while (!sim.over) {
      sim.step(DT);
      if (!sim.over && sim.time >= match.timeLimit) sim.endOnTime();
    }
    return {
      winner: sim.winner ? sim.balls.indexOf(sim.winner) : null,
      decidedBy: sim.decidedBy ?? 'ko',
      time: sim.time,
      hp: sim.balls.map((ball) => ball.hp),
      ranking: sim.ranking,
    };
  } finally {
    Math.random = realRandom;
  }
}

async function post(path, body) {
  const res = await fetch(`${GAME}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) console.warn(`${path}: ${(await res.json()).error}`);
}

async function receive(screens) {
  for (const match of screens) {
    if (!match || played.has(match.id)) continue;
    played.add(match.id);
    await post(`/matches/${match.id}/start`);
    const result = play(match);
    const names = match.fighters.map((f) => f.name ?? f.weapon);
    console.log(`screen ${match.screen + 1}: ${names.join(' v ')} -> ${result.winner === null ? 'draw' : names[result.winner]} (${result.decidedBy}, ${result.time.toFixed(1)}s)`);
    setTimeout(() => void post(`/matches/${match.id}/result`, result), DELAY);
  }
}

// Reads the display's event stream, reconnecting when it drops.
for (;;) {
  try {
    const res = await fetch(`${GAME}/api/display`);
    console.log(`Connected to ${GAME} as a display.`);
    let buffer = '';
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = message.split('\n').find((line) => line.startsWith('data: '));
        if (data) await receive(JSON.parse(data.slice(6)).screens);
      }
    }
  } catch (err) {
    console.warn(`Display connection: ${err.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
