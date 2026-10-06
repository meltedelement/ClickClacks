// The flawless finder's search: plays seeded matches and picks out the ones won
// by a fighter that never got hit. Pure like the sim (no DOM, no Node APIs), so
// the command-line tool (tools/flawless.js, in worker threads) and the finder
// page (flawless.html, in Web Workers) share it and find the same matches for
// the same options.
//
// A search is numbered matches 0, 1, 2, ...; match `index`'s fighters and seed
// come from the base seed alone. Callers hand out chunks of CHUNK_SIZE indices
// with runTask and put the results together with collect, which only counts
// chunks that are in back to back from 0, so which matches a search reports
// doesn't depend on which worker finished first.
//
// "Never got hit" means no enemy weapon hit landed and no HP was lost to
// anything else (thorns, burns, spikes, sudden death...). Dodged hits and hits
// stopped by a shield don't count. `hitsOnly` counts weapon hits alone.
//
// Fighters come from a list of entries: a fighter spec ('sword+damage:3+crit')
// or 'any' for a random build. An entry marked must-win ('*sword' in text) has
// to be the one that wins: every match then has one of them in it, and a match
// won by anyone else doesn't count.

import { CONFIG } from '../config.js';
import { Simulation } from '../sim/Simulation.js';
import { mulberry32 } from '../sim/random.js';
import { WEAPONS, getWeaponById } from '../weapons/index.js';
import { UPGRADES, getUpgradeById, resolveUpgrades, upgradesFor } from '../upgrades/index.js';

export const CHUNK_SIZE = 50; // matches handed to a worker at a time
export const MAX_API_TIME_LIMIT = 600; // the most POST /api/matches accepts (server/matches.js)
const DT = 1 / CONFIG.physicsHz;

// Search options, all plain data so they can be posted to a worker:
//   seed             base seed
//   entries          fighter entries ({ spec, mustWin }, see parseEntry) to
//                    pick from, or null for random builds only
//   fighters         fighters per match (more than two is a free-for-all)
//   upgrades         most upgrade copies per random build
//   transformations  most transformations per random build
//   hitsOnly         only enemy weapon hits count
//   timeLimit        sim seconds before a match is a draw
//   suddenDeath      sim seconds before sudden death, or null for none
export const DEFAULTS = {
  entries: null,
  fighters: 2,
  upgrades: 6,
  transformations: 1,
  hitsOnly: false,
  timeLimit: 180,
  suddenDeath: CONFIG.suddenDeath.after,
};

// Plays matches start..start+count-1 and returns the flawless ones, plus the
// closest miss (the winner that took the fewest hits) in case there are none.
export function runTask({ start, count, opts }) {
  const found = [];
  let closest = null;
  for (let index = start; index < start + count; index++) {
    const match = playMatch(index, opts);
    if (!match) continue;
    if (match.taken === 0) found.push(match);
    else if (!closest || match.taken < closest.taken) closest = match;
  }
  return { start, count, found, closest };
}

// Puts runTask results (chunk start -> result) together: the finds, up to
// `count`, the closest miss and how many matches that covers, from the chunks
// that are in back to back from 0.
export function collect(results, count) {
  const found = [];
  let closest = null;
  let played = 0;
  for (let start = 0; results.has(start); start += CHUNK_SIZE) {
    const r = results.get(start);
    found.push(...r.found);
    played += r.count;
    if (r.closest && (!closest || r.closest.taken < closest.taken)) closest = r.closest;
    if (found.length >= count) break;
  }
  return { found: found.slice(0, count), closest, played };
}

// Match `index` of the search. Returns null for a draw, or when a fighter
// that had to win didn't.
export function playMatch(index, { seed, entries, fighters, upgrades, transformations, hitsOnly, timeLimit, suddenDeath }) {
  const rng = mulberry32(mixSeed(seed, index, 1));
  const lineup = entries ? pickLineup(rng, entries, fighters) : Array.from({ length: fighters }, () => ({ spec: ANY, mustWin: false }));
  const specs = lineup.map(({ spec }) => (spec === ANY ? randomSpec(rng, upgrades, transformations) : spec));
  const matchSeed = mixSeed(seed, index, 2);

  // Everything random in the sim goes through Math.random, so seeding it makes the match reproducible.
  const realRandom = Math.random;
  Math.random = mulberry32(matchSeed);
  try {
    const taken = specs.map(() => 0); // hits (and other damage) each fighter took
    const onEvent = (type, e) => {
      if (type !== 'hit' && (type !== 'damage' || e.dealt <= 0 || hitsOnly)) return;
      const slot = sim.balls.indexOf(e.target);
      if (slot >= 0) taken[slot]++;
    };
    const sim = new Simulation(specs.map(toLoadout), { onEvent, suddenDeath });
    while (!sim.over && sim.time < timeLimit) sim.step(DT);
    if (!sim.over || !sim.winner) return null;

    const winner = sim.balls.indexOf(sim.winner);
    if (lineup.some((entry) => entry.mustWin) && !lineup[winner].mustWin) return null;
    const random = lineup.map(({ spec }) => spec === ANY); // which fighters were 'any'
    return { index, seed: matchSeed, specs, random, winner, taken: taken[winner], time: sim.time, hp: sim.winner.hp, maxHp: sim.winner.maxHp };
  } finally {
    Math.random = realRandom;
  }
}

// `count` different entries from the list (repeats only if the list is too
// short), always including one that must win if there are any, in random order
// so a must-win fighter doesn't always start on the same side.
function pickLineup(rng, entries, count) {
  const pool = [...entries];
  const take = (options) => pool.splice(pool.indexOf(options[Math.floor(rng() * options.length)]), 1)[0];
  const lineup = [];
  const mustWin = pool.filter((entry) => entry.mustWin);
  if (mustWin.length) lineup.push(take(mustWin));
  while (lineup.length < count) {
    if (!pool.length) pool.push(...entries);
    lineup.push(take(pool));
  }
  for (let i = lineup.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
  }
  return lineup;
}

// A random weapon with 0..maxTransformations transformations and 0..maxUpgrades
// upgrade copies, each picked from what the build could take at that point.
function randomSpec(rng, maxUpgrades, maxTransformations) {
  const weapon = WEAPONS[Math.floor(rng() * WEAPONS.length)].id;
  const owned = [];
  const pick = (transformation) => {
    const options = upgradesFor(weapon, owned).filter((U) => U.transformation === transformation);
    if (options.length) owned.push(options[Math.floor(rng() * options.length)].id);
  };
  const nTransformations = Math.floor(rng() * (maxTransformations + 1));
  const nUpgrades = Math.floor(rng() * (maxUpgrades + 1));
  for (let i = 0; i < nTransformations; i++) pick(true);
  for (let i = 0; i < nUpgrades; i++) pick(false);
  return toSpec(weapon, owned);
}

// ---- Fighter specs ------------------------------------------------------------------

export const ANY = 'any'; // an entry for a random build

// '*sword+crit' -> { spec: 'sword+crit', mustWin: true }; 'any' -> { spec: 'any', mustWin: false }.
// Throws if the spec is bad (see parseSpec).
export function parseEntry(text) {
  let spec = text.trim();
  const mustWin = spec.startsWith('*');
  if (mustWin) spec = spec.slice(1).trim();
  if (!spec) throw new Error('empty fighter');
  return { spec: spec.toLowerCase() === ANY ? ANY : normalizeSpec(spec), mustWin };
}

export const entryText = ({ spec, mustWin }) => (mustWin ? '*' : '') + spec;

// 'sword+damage:2+lifesteal' -> { weapon, transformations, upgrades }, with stacks
// spelled out. Throws if anything is unknown or doesn't fit the weapon.
export function parseSpec(spec) {
  const [weapon, ...parts] = spec.split('+').map((part) => part.trim());
  const ids = parts.flatMap((part) => {
    const [id, count = '1'] = part.split(':');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`bad stack count in "${part}"`);
    return Array(n).fill(id);
  });
  resolveUpgrades(ids, getWeaponById(weapon).id);
  const transformation = (id) => getUpgradeById(id).transformation;
  return { weapon, transformations: ids.filter(transformation), upgrades: ids.filter((id) => !transformation(id)) };
}

// Checks a spec and writes it the standard way (throws like parseSpec).
export function normalizeSpec(spec) {
  const { weapon, transformations, upgrades } = parseSpec(spec);
  return toSpec(weapon, [...transformations, ...upgrades]);
}

// The loadout the display page builds from a match API fighter: transformations
// first, then upgrades, so a replay applies them in the same order.
export function toLoadout(spec) {
  const { weapon, transformations, upgrades } = parseSpec(spec);
  return { weapon, upgrades: [...transformations, ...upgrades] };
}

// Weapon then transformations then upgrades, in registry order with counts.
function toSpec(weapon, ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const order = (id) => {
    const U = getUpgradeById(id);
    return (U.transformation ? 0 : 1000) + UPGRADES.indexOf(U);
  };
  const parts = [...counts].sort(([a], [b]) => order(a) - order(b)).map(([id, n]) => (n > 1 ? `${id}:${n}` : id));
  return [weapon, ...parts].join('+');
}

// The body for POST /api/matches that replays a find.
export function matchRequest(find, opts) {
  return {
    characters: find.specs.map(parseSpec),
    seed: find.seed,
    settings: { timeLimit: opts.timeLimit, suddenDeath: opts.suddenDeath },
  };
}

export function mixSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
