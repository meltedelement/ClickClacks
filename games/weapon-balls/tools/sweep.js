// Upgrade sweep: finds the upgrades, transformations, stacks and weapons that are
// outliers in strength, per weapon and overall, at several upgrade levels.
//
// Every combination of upgrades is far too many fighters to play against each
// other, so the sweep samples instead. For each tier (a number of upgrade
// copies and transformations) it draws an opponent pool of random builds at
// that tier, the way a quiz team collects them. Candidates then play every
// opponent in the pool:
//   pick       random bases one upgrade short of the tier, each completed with
//              every upgrade it could take. An upgrade's value is how much
//              better its builds did than the other builds from the same base
//              (in win % points), so a weapon's own strength cancels out.
//   transform  the same, with bases one transformation short and completed
//              with every transformation.
//   stack      one upgrade stacked N times (sword+damage:5) against the pool
//              at N upgrades: which upgrades get out of hand when repeated.
// All builds from one base meet the same opponents with the same seeds.
// Matches use the tournament's rules: the HP tiebreak, so none is a draw.
//
// Results are appended to a JSON lines file as they come in. Running the same
// command again resumes an interrupted sweep, and --report reprints the report
// from a finished file without playing anything.
//
// Usage: node tools/sweep.js [options]      (npm run sweep -- [options])
//   --tiers LIST          upgrades/transformations per tier (default 1/0,3/0,6/1,10/2)
//   -w, --weapons a,b     weapons to test (default all; the pool always has all)
//   -S, --sections LIST   pick,transform,stack (default all three)
//       --stack-levels L  stack counts for the stack section (default 1,3,5)
//   -b, --bases N         random bases per weapon per tier (default 6)
//   -p, --pool N          opponent builds per weapon per tier (default 6)
//   -g, --games N         matches per candidate vs opponent, sides alternate (default 2)
//       --threshold P     win % points an outlier must be off by (default 5)
//   -t, --time-limit S    simulated seconds before the HP tiebreak (default 180)
//   -s, --seed N          seed for the builds and matches (default 1)
//   -j, --jobs N          worker threads (default: CPU cores - 1)
//   -o, --out FILE        results file (default sweeps/sweep-<seed>.jsonl)
//       --fresh           overwrite the results file instead of resuming it
//   -n, --dry-run         print the plan's size and exit
//   -r, --report FILE     print the report for an existing results file and exit
//       --json FILE       also write the report as JSON
//   -h, --help
//
// Examples:
//   npm run sweep -- -n                              # how many matches the defaults are
//   npm run sweep                                    # ~90k matches, ~20 min on 12 cores
//   npm run sweep -- -b 12 -g 4 -o sweeps/big.jsonl  # ~4x the matches, half the noise
//   npm run sweep -- -w mace -S pick,stack --tiers 2/0,5/0
//   npm run sweep -- -r sweeps/sweep-1.jsonl --threshold 3

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { CONFIG } from '../src/config.js';
import { Simulation } from '../src/sim/Simulation.js';
import { mulberry32 } from '../src/sim/random.js';
import { WEAPONS, getWeaponById } from '../src/weapons/index.js';
import { UPGRADES, getUpgradeById, upgradesFor } from '../src/upgrades/index.js';

const CHUNK_MATCHES = 24; // matches handed to a worker at a time
const FAIR_WEAPON = [0.45, 0.55];
const MIN_BUILD_GAMES = 40; // a build needs this many matches to be ranked
const DT = 1 / CONFIG.physicsHz;

// ---- Worker: playing matches -------------------------------------------------

// A task is one candidate against one opponent: `seeds.length` matches, sides alternating.
function runTask({ key, candidate, opponent, seeds, timeLimit }) {
  let wins = 0;
  let hpShare = 0; // candidate's HP share minus the opponent's, summed over matches
  seeds.forEach((seed, game) => {
    const lineup = game % 2 === 0 ? [candidate, opponent] : [opponent, candidate];
    const me = game % 2 === 0 ? 0 : 1;
    const sim = playMatch(lineup.map(parseSpec), seed, timeLimit);
    if (sim.balls.indexOf(sim.winner) === me) wins++;
    const share = (ball) => Math.max(0, ball.hp) / ball.maxHp;
    hpShare += share(sim.balls[me]) - share(sim.balls[1 - me]);
  });
  return { key, games: seeds.length, wins, hpShare };
}

function playMatch(loadouts, seed, timeLimit) {
  // Everything random in the sim goes through Math.random, so seeding it makes matches reproducible.
  Math.random = mulberry32(seed);
  const sim = new Simulation(loadouts, { tiebreak: 'hp' });
  while (!sim.over && sim.time < timeLimit) sim.step(DT);
  sim.endOnTime();
  return sim;
}

// ---- Builds -------------------------------------------------------------------

// A build is a fighter spec: the weapon, its transformations, then its upgrades
// in registry order with counts, e.g. 'sword+stalwart+damage:2+crit'. Written
// the same way every time, so equal builds have equal specs.
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

function parseSpec(spec) {
  const [weapon, ...parts] = spec.split('+');
  const upgrades = parts.flatMap((part) => {
    const [id, n = '1'] = part.split(':');
    return Array(Number(n)).fill(id);
  });
  return { weapon, upgrades };
}

const transformationsFor = (weapon, owned) => upgradesFor(weapon, owned).filter((U) => U.transformation);
const smallUpgradesFor = (weapon, owned) => upgradesFor(weapon, owned).filter((U) => !U.transformation);

// A random build with `upgrades` copies of small upgrades and `transformations`
// transformations, each picked from what the build could take at that point.
function randomBuild(rng, weapon, upgrades, transformations) {
  const owned = [];
  const pick = (options) => options.length && owned.push(options[Math.floor(rng() * options.length)].id);
  for (let i = 0; i < transformations; i++) pick(transformationsFor(weapon, owned));
  for (let i = 0; i < upgrades; i++) pick(smallUpgradesFor(weapon, owned));
  return owned;
}

// Up to `count` different random builds (fewer if there aren't that many).
function randomBuilds(rng, weapon, upgrades, transformations, count) {
  const found = new Map();
  for (let tries = 0; found.size < count && tries < count * 20; tries++) {
    const ids = randomBuild(rng, weapon, upgrades, transformations);
    found.set(toSpec(weapon, ids), ids);
  }
  return [...found.values()];
}

// ---- Plan -----------------------------------------------------------------------

// Everything the sweep will play, worked out from the options alone, so a rerun
// with the same options has the same tasks (and can skip the finished ones).
function buildPlan(opts) {
  const rng = mulberry32(opts.seed);
  const pools = new Map(); // tier key -> opponent specs
  const pool = (u, t) => {
    const key = `${u}/${t}`;
    if (!pools.has(key)) {
      pools.set(key, WEAPONS.flatMap((W) => randomBuilds(rng, W.id, u, t, opts.pool).map((ids) => toSpec(W.id, ids))));
    }
    return pools.get(key);
  };

  const tasks = [];
  // One candidate against the whole pool. Seeds depend on the group, not the
  // variant, so every variant of a base meets each opponent in the same matches.
  const addCandidate = ({ section, tier, weapon, base, variant, spec }, opponents) => {
    opponents.forEach((opponent, o) => {
      const seeds = Array.from({ length: opts.games }, (_, g) => mixSeed(opts.seed, hashString(`${section}|${tier}|${weapon}`), base, o, g));
      tasks.push({ key: `${section}|${tier}|${weapon}|${base}|${variant}|${o}`, section, tier, weapon, base, variant, candidate: spec, opponent, seeds });
    });
  };

  const weapons = opts.weapons;
  for (const { u, t } of opts.tiers) {
    const tier = `${u}/${t}`;
    if (opts.sections.includes('pick') && u > 0) {
      const opponents = pool(u, t);
      for (const weapon of weapons) {
        randomBuilds(rng, weapon, u - 1, t, opts.bases).forEach((baseIds, base) => {
          for (const U of smallUpgradesFor(weapon, baseIds)) {
            addCandidate({ section: 'pick', tier, weapon, base, variant: U.id, spec: toSpec(weapon, [...baseIds, U.id]) }, opponents);
          }
        });
      }
    }
    if (opts.sections.includes('transform') && t > 0) {
      const opponents = pool(u, t);
      for (const weapon of weapons) {
        // Builds are drawn transformations first, so draw the base's transformations,
        // then its upgrades with every candidate transformation's exclusions in mind.
        randomBuilds(rng, weapon, u, t - 1, opts.bases).forEach((baseIds, base) => {
          for (const U of transformationsFor(weapon, baseIds)) {
            addCandidate({ section: 'transform', tier, weapon, base, variant: U.id, spec: toSpec(weapon, [...baseIds, U.id]) }, opponents);
          }
        });
      }
    }
  }
  if (opts.sections.includes('stack')) {
    for (const n of opts.stackLevels) {
      const opponents = pool(n, 0);
      for (const weapon of weapons) {
        for (const U of smallUpgradesFor(weapon, [])) {
          if (n > U.maxStacks) continue;
          addCandidate({ section: 'stack', tier: `${n}/0`, weapon, base: 0, variant: U.id, spec: toSpec(weapon, Array(n).fill(U.id)) }, opponents);
        }
      }
    }
  }
  return { tasks, pools: Object.fromEntries(pools) };
}

// ---- Main thread ----------------------------------------------------------------

async function main() {
  const opts = readOptions();
  if (opts.report) {
    const { header, results } = readResults(opts.report);
    return finish(header.options, results, opts);
  }

  const { tasks } = buildPlan(opts);
  const matches = tasks.reduce((n, t) => n + t.seeds.length, 0);
  printPlan(tasks, matches, opts);
  if (opts.dryRun) return;

  const header = { type: 'header', options: pickOptions(opts) };
  let done = new Map();
  if (existsSync(opts.out) && !opts.fresh) {
    const previous = readResults(opts.out);
    if (JSON.stringify(previous.header.options) !== JSON.stringify(header.options)) {
      fail(`${opts.out} holds a sweep with other options. Pass --fresh to overwrite it, or --out another file.`);
    }
    done = previous.results;
    console.log(`Resuming ${opts.out}: ${done.size} of ${tasks.length} tasks already played.`);
  } else {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(header) + '\n');
  }

  const todo = tasks.filter((t) => !done.has(t.key));
  if (todo.length) {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    const started = performance.now();
    await runPool(chunk(todo), opts, todo.reduce((n, t) => n + t.seeds.length, 0), started, (results) => {
      const lines = results.map((r) => {
        const { seeds, opponent, candidate, ...meta } = byKey.get(r.key);
        const record = { type: 'result', ...meta, candidate, opponent, games: r.games, wins: r.wins, hpShare: r.hpShare };
        done.set(r.key, record);
        return JSON.stringify(record);
      });
      appendFileSync(opts.out, lines.join('\n') + '\n');
    });
    const secs = (performance.now() - started) / 1000;
    console.log(`Played ${todo.reduce((n, t) => n + t.seeds.length, 0)} matches in ${secs.toFixed(0)}s. Results in ${opts.out}\n`);
  }
  finish(header.options, done, opts);
}

function finish(options, results, opts) {
  const report = analyse(options, [...results.values()], opts.threshold);
  printReport(report, opts.threshold);
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${opts.json}`);
  }
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      tiers: { type: 'string', default: '1/0,3/0,6/1,10/2' },
      weapons: { type: 'string', short: 'w' },
      sections: { type: 'string', short: 'S', default: 'pick,transform,stack' },
      'stack-levels': { type: 'string', default: '1,3,5' },
      bases: { type: 'string', short: 'b', default: '6' },
      pool: { type: 'string', short: 'p', default: '6' },
      games: { type: 'string', short: 'g', default: '2' },
      threshold: { type: 'string', default: '5' },
      'time-limit': { type: 'string', short: 't', default: '180' },
      seed: { type: 'string', short: 's', default: '1' },
      jobs: { type: 'string', short: 'j' },
      out: { type: 'string', short: 'o' },
      fresh: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', short: 'n', default: false },
      report: { type: 'string', short: 'r' },
      json: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(readUsage());
    process.exit(0);
  }

  const list = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);
  const weapons = values.weapons ? list(values.weapons) : WEAPONS.map((W) => W.id);
  for (const id of weapons) {
    try {
      getWeaponById(id);
    } catch {
      fail(`Unknown weapon "${id}" (weapons: ${WEAPONS.map((W) => W.id).join(', ')})`);
    }
  }
  const tiers = list(values.tiers).map((text) => {
    const [u, t = '0'] = text.split('/');
    return { u: nonNegativeInt(u, 'tiers'), t: nonNegativeInt(t, 'tiers') };
  });
  const sections = list(values.sections);
  for (const s of sections) if (!['pick', 'transform', 'stack'].includes(s)) fail(`Unknown section "${s}" (pick, transform, stack)`);
  const seed = Number(values.seed) >>> 0;

  return {
    tiers,
    weapons,
    sections,
    stackLevels: list(values['stack-levels']).map((n) => positiveInt(n, 'stack-levels')),
    bases: positiveInt(values.bases, 'bases'),
    pool: positiveInt(values.pool, 'pool'),
    games: positiveInt(values.games, 'games'),
    threshold: Number(values.threshold) / 100,
    timeLimit: positiveInt(values['time-limit'], 'time-limit'),
    seed,
    jobs: values.jobs ? positiveInt(values.jobs, 'jobs') : Math.max(1, availableParallelism() - 1),
    out: values.out ?? `sweeps/sweep-${seed}.jsonl`,
    fresh: values.fresh,
    dryRun: values['dry-run'],
    report: values.report,
    json: values.json,
  };
}

// The options that decide what gets played (so a resume must match them).
function pickOptions({ tiers, weapons, sections, stackLevels, bases, pool, games, timeLimit, seed }) {
  return { tiers, weapons, sections, stackLevels, bases, pool, games, timeLimit, seed };
}

function readResults(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0] ?? '{}');
  if (header.type !== 'header') fail(`${file} is not a sweep results file.`);
  const results = new Map();
  for (const line of lines.slice(1)) {
    try {
      const r = JSON.parse(line);
      results.set(r.key, r);
    } catch {
      // A line cut off by an interrupted run; its task is played again.
    }
  }
  return { header, results };
}

function printPlan(tasks, matches, opts) {
  const bySection = {};
  for (const t of tasks) {
    const s = (bySection[t.section] ??= { candidates: new Set(), matches: 0 });
    s.candidates.add(`${t.tier}|${t.weapon}|${t.base}|${t.variant}`);
    s.matches += t.seeds.length;
  }
  console.log(`Sweep, seed ${opts.seed}: tiers ${opts.tiers.map((t) => `${t.u}/${t.t}`).join(', ')}; weapons ${opts.weapons.join(', ')}`);
  for (const [section, s] of Object.entries(bySection)) {
    console.log(`  ${section.padEnd(10)} ${String(s.candidates.size).padStart(5)} candidates  ${String(s.matches).padStart(7)} matches`);
  }
  // Roughly 7-8 matches a second per core on a desktop CPU.
  const estimate = matches / (opts.jobs * 7.5);
  console.log(`  ${'total'.padEnd(10)} ${' '.repeat(18)}${String(matches).padStart(7)} matches, very roughly ${formatDuration(estimate)} on ${opts.jobs} workers\n`);
}

function chunk(tasks) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const t of tasks) {
    current.push(t);
    size += t.seeds.length;
    if (size >= CHUNK_MATCHES) {
      chunks.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function runPool(chunks, { jobs, timeLimit }, total, started, onResults) {
  return new Promise((resolve, reject) => {
    let next = 0;
    let played = 0;
    let running = Math.min(jobs, chunks.length);

    const progress = () => {
      if (!process.stderr.isTTY) return;
      const secs = (performance.now() - started) / 1000;
      const eta = played ? (secs / played) * (total - played) : 0;
      const bar = '#'.repeat(Math.round((played / total) * 30)).padEnd(30, '.');
      process.stderr.write(`\r[${bar}] ${played}/${total}  ${formatDuration(secs)} elapsed, ~${formatDuration(eta)} left `);
    };

    for (let i = 0; i < running; i++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next < chunks.length) {
          const tasks = chunks[next++].map(({ key, candidate, opponent, seeds }) => ({ key, candidate, opponent, seeds }));
          return worker.postMessage({ tasks, timeLimit });
        }
        worker.terminate();
        if (--running === 0) {
          if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
          resolve();
        }
      };
      worker.on('message', (results) => {
        played += results.reduce((n, r) => n + r.games, 0);
        onResults(results);
        progress();
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
}

// ---- Analysis -------------------------------------------------------------------

function analyse(options, results, threshold) {
  const rate = (r) => r.wins / r.games;
  const oppWeapon = (r) => r.opponent.split('+')[0];

  // Per candidate: its games and wins over the whole pool.
  const candidates = new Map();
  for (const r of results) {
    const id = `${r.section}|${r.tier}|${r.weapon}|${r.base}|${r.variant}`;
    const c = candidates.get(id) ?? { section: r.section, tier: r.tier, weapon: r.weapon, base: r.base, variant: r.variant, spec: r.candidate, games: 0, wins: 0, hpShare: 0 };
    c.games += r.games;
    c.wins += r.wins;
    c.hpShare += r.hpShare;
    candidates.set(id, c);
  }
  for (const c of candidates.values()) c.winRate = c.wins / c.games;

  // Value of each variant: its win rate minus the average of its group (the
  // other variants of the same base), averaged over the bases it appeared in.
  const values = (section) => {
    const groups = groupBy([...candidates.values()].filter((c) => c.section === section), (c) => `${c.tier}|${c.weapon}|${c.base}`);
    const cells = new Map(); // tier|weapon|variant
    for (const group of groups.values()) {
      const mean = group.reduce((s, c) => s + c.winRate, 0) / group.length;
      for (const c of group) {
        const key = `${c.tier}|${c.weapon}|${c.variant}`;
        const cell = cells.get(key) ?? { tier: c.tier, weapon: c.weapon, variant: c.variant, deltaSum: 0, bases: 0, games: 0, wins: 0 };
        cell.deltaSum += (c.winRate - mean) * c.games;
        cell.games += c.games;
        cell.wins += c.wins;
        cell.bases++;
        cells.set(key, cell);
      }
    }
    return [...cells.values()].map(({ deltaSum, ...cell }) => finishCell({ ...cell, value: deltaSum / cell.games }));
  };

  // The same cells pooled over tiers (per weapon), then over weapons.
  const combine = (cells, keyOf) =>
    [...groupBy(cells, keyOf).values()].map((group) => {
      const games = group.reduce((s, c) => s + c.games, 0);
      return finishCell({
        ...group[0],
        tier: group.length > 1 && new Set(group.map((c) => c.tier)).size > 1 ? 'all' : group[0].tier,
        weapon: new Set(group.map((c) => c.weapon)).size > 1 ? 'all' : group[0].weapon,
        games,
        wins: group.reduce((s, c) => s + c.wins, 0),
        bases: group.reduce((s, c) => s + c.bases, 0),
        value: group.reduce((s, c) => s + c.value * c.games, 0) / games,
        weapons: new Set(group.map((c) => c.weapon)).size,
      });
    });

  const section = (name) => {
    const byTier = values(name);
    const byWeapon = combine(byTier, (c) => `${c.weapon}|${c.variant}`);
    const overall = combine(byWeapon, (c) => c.variant).filter((c) => c.weapons > 1);
    return { byTier, byWeapon, overall };
  };

  // Weapon strength per tier: every pick/transform candidate against other weapons.
  const weaponRows = [];
  const matrix = {};
  for (const r of results) {
    if (r.section === 'stack') continue;
    const opp = oppWeapon(r);
    const cell = ((matrix[r.tier] ??= {})[r.weapon] ??= {})[opp] ??= { games: 0, wins: 0 };
    cell.games += r.games;
    cell.wins += r.wins;
  }
  for (const [tier, rows] of Object.entries(matrix)) {
    for (const [weapon, cols] of Object.entries(rows)) {
      const other = Object.entries(cols).filter(([opp]) => opp !== weapon);
      const games = other.reduce((s, [, c]) => s + c.games, 0);
      const wins = other.reduce((s, [, c]) => s + c.wins, 0);
      weaponRows.push({ tier, weapon, games, winRate: wins / (games || 1), ci: marginOfError(wins, games) });
      for (const c of Object.values(cols)) c.winRate = c.wins / c.games;
    }
  }

  const builds = [...candidates.values()]
    .filter((c) => c.section !== 'stack' && c.games >= MIN_BUILD_GAMES)
    .sort((a, b) => b.winRate - a.winRate)
    .map(({ tier, spec, games, wins, winRate }) => ({ tier, spec, games, winRate, ci: marginOfError(wins, games) }));

  const pick = section('pick');
  const transform = section('transform');
  const stack = section('stack');

  const flag = (c) => (c.value - c.ci > threshold ? 'strong' : c.value + c.ci < -threshold ? 'weak' : null);
  const outliers = [];
  for (const [name, s] of [['pick', pick], ['transform', transform], ['stack', stack]]) {
    // Per weapon pooled over tiers, overall pooled over weapons, and single tiers too
    // (an upgrade can be fine early and broken late).
    const seen = new Set();
    for (const c of [...s.overall, ...s.byWeapon, ...s.byTier]) {
      const verdict = flag(c);
      // A cell with one tier is the same cell as its all-tiers one.
      const key = `${c.weapon}|${c.variant}|${c.games}`;
      if (verdict && !seen.has(key)) outliers.push({ section: name, verdict, ...c });
      seen.add(key);
    }
  }
  for (const w of weaponRows) {
    if (w.winRate - w.ci > FAIR_WEAPON[1]) outliers.push({ section: 'weapon', verdict: 'strong', tier: w.tier, weapon: w.weapon, variant: w.weapon, value: w.winRate - 0.5, ci: w.ci, games: w.games });
    if (w.winRate + w.ci < FAIR_WEAPON[0]) outliers.push({ section: 'weapon', verdict: 'weak', tier: w.tier, weapon: w.weapon, variant: w.weapon, value: w.winRate - 0.5, ci: w.ci, games: w.games });
  }

  return {
    options,
    matches: results.reduce((s, r) => s + r.games, 0),
    weapons: weaponRows,
    matrix,
    pick,
    transform,
    stack,
    builds: { best: builds.slice(0, 15), worst: builds.slice(-15).reverse() },
    outliers,
  };
}

// The confidence interval ignores the group mean's own noise (it averages many
// variants) and treats the matches as independent coin flips.
function finishCell(cell) {
  return { ...cell, winRate: cell.wins / cell.games, ci: marginOfError(cell.wins, cell.games) };
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// Half-width of a 95% confidence interval on a win rate. Two made-up matches
// (one won, one lost) keep a 0% or 100% rate from getting a zero-width interval.
function marginOfError(wins, games) {
  const p = (wins + 1) / (games + 2);
  return games ? 1.96 * Math.sqrt((p * (1 - p)) / games) : 0;
}

// ---- Printing -------------------------------------------------------------------

function printReport(report, threshold) {
  const { options } = report;
  const tiers = options.tiers.map((t) => `${t.u}/${t.t}`);
  const weaponIds = WEAPONS.map((W) => W.id).filter((id) => options.weapons.includes(id));
  const name = (id) => getUpgradeById(id).displayName;
  console.log(`${report.matches} matches. Tiers are upgrades/transformations. Values are win % points over the average pick from the same base.`);

  heading('Weapon win rate vs other weapons, by tier');
  const wr = (tier, weapon) => report.weapons.find((w) => w.tier === tier && w.weapon === weapon);
  const weaponTiers = tiers.filter((tier) => report.weapons.some((w) => w.tier === tier));
  table(
    ['Weapon', ...weaponTiers],
    weaponIds.map((weapon) => [
      getWeaponById(weapon).displayName,
      ...weaponTiers.map((tier) => {
        const w = wr(tier, weapon);
        return w ? `${rateCell(w.winRate, FAIR_WEAPON)} ${dim(`±${pct(w.ci)}`)}` : dim('-');
      }),
    ]),
  );

  const valueTable = (title, s, variantsOf) => {
    if (!s.byTier.length) return;
    heading(title);
    for (const weapon of weaponIds) {
      const rows = variantsOf(weapon).filter((id) => s.byWeapon.some((c) => c.weapon === weapon && c.variant === id));
      if (!rows.length) continue;
      const cellTiers = tiers.filter((tier) => s.byTier.some((c) => c.weapon === weapon && c.tier === tier));
      console.log(`\n  ${bold(getWeaponById(weapon).displayName)}`);
      table(
        ['', 'All tiers', '±95%', ...cellTiers],
        rows
          .map((id) => ({ id, all: s.byWeapon.find((c) => c.weapon === weapon && c.variant === id) }))
          .sort((a, b) => b.all.value - a.all.value)
          .map(({ id, all }) => [
            name(id),
            valueCell(all, threshold),
            dim(pct(all.ci)),
            ...cellTiers.map((tier) => {
              const c = s.byTier.find((x) => x.weapon === weapon && x.variant === id && x.tier === tier);
              return c ? valueCell(c, threshold) : dim('-');
            }),
          ]),
      );
    }
    if (s.overall.length) {
      console.log(`\n  ${bold('Every weapon')}`);
      table(
        ['', 'All', '±95%', ...weaponIds.map((w) => getWeaponById(w).displayName)],
        [...s.overall]
          .sort((a, b) => b.value - a.value)
          .map((c) => [
            name(c.variant),
            valueCell(c, threshold),
            dim(pct(c.ci)),
            ...weaponIds.map((weapon) => {
              const w = s.byWeapon.find((x) => x.weapon === weapon && x.variant === c.variant);
              return w ? valueCell(w, threshold) : dim('-');
            }),
          ]),
      );
    }
  };

  const small = (weapon) => UPGRADES.filter((U) => !U.transformation && U.canApplyTo(weapon)).map((U) => U.id);
  const big = (weapon) => UPGRADES.filter((U) => U.transformation && U.canApplyTo(weapon)).map((U) => U.id);
  valueTable('Upgrade picks (value of taking it as the last upgrade)', report.pick, small);
  valueTable('Transformations (value of taking it as the last transformation)', report.transform, big);

  if (report.stack.byTier.length) {
    heading('Stacks (one upgrade N times vs random N-upgrade builds: win %, and value over other stacks)');
    const levels = options.stackLevels;
    for (const weapon of weaponIds) {
      const rows = small(weapon).filter((id) => report.stack.byTier.some((c) => c.weapon === weapon && c.variant === id));
      if (!rows.length) continue;
      console.log(`\n  ${bold(getWeaponById(weapon).displayName)}`);
      table(
        ['', ...levels.map((n) => `x${n} win %`), ...levels.map((n) => `x${n} value`)],
        rows.map((id) => {
          const at = (n) => report.stack.byTier.find((c) => c.weapon === weapon && c.variant === id && c.tier === `${n}/0`);
          return [
            name(id),
            ...levels.map((n) => (at(n) ? pct(at(n).winRate) : dim('-'))),
            ...levels.map((n) => (at(n) ? valueCell(at(n), threshold) : dim('-'))),
          ];
        }),
      );
    }
  }

  if (report.builds.best.length) {
    heading(`Best builds (at least ${MIN_BUILD_GAMES} matches)`);
    table(['Build', 'Tier', 'Win %', '±95%'], report.builds.best.map((b) => [b.spec, b.tier, pct(b.winRate), dim(pct(b.ci))]));
    heading('Worst builds');
    table(['Build', 'Tier', 'Win %', '±95%'], report.builds.worst.map((b) => [b.spec, b.tier, pct(b.winRate), dim(pct(b.ci))]));
  }

  heading(`Outliers (off by more than ${pct(threshold)} points, beyond the 95% interval)`);
  if (!report.outliers.length) console.log('  None. Run more matches (-b, -g) to narrow the intervals, or lower --threshold.');
  const label = (o) => (o.section === 'weapon' ? getWeaponById(o.weapon).displayName : name(o.variant));
  table(
    ['', 'Section', 'Weapon', 'Tier', 'Value', '±95%', 'Matches'],
    [...report.outliers]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((o) => [
        o.verdict === 'strong' ? red(`${label(o)} (strong)`) : blue(`${label(o)} (weak)`),
        o.section,
        o.weapon === 'all' ? 'every weapon' : getWeaponById(o.weapon).displayName,
        o.tier,
        signed(o.value),
        dim(pct(o.ci)),
        o.games,
      ]),
  );
}

function valueCell(c, threshold) {
  const text = signed(c.value);
  if (c.value - c.ci > threshold) return red(text);
  if (c.value + c.ci < -threshold) return blue(text);
  if (Math.abs(c.value) > threshold) return yellow(text);
  return text;
}

function rateCell(rate, [lo, hi]) {
  const text = pct(rate);
  if (rate > hi) return red(text);
  if (rate < lo) return blue(text);
  return text;
}

const pct = (p) => (p == null ? '-' : `${(p * 100).toFixed(1)}%`);
const signed = (p) => `${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}`;

function heading(text) {
  console.log(`\n${bold(text)}`);
}

// Prints aligned columns: first column left-aligned, the rest right-aligned.
function table(headers, rows) {
  const all = [headers.map(bold), ...rows];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => visibleLength(String(r[c] ?? '')))));
  for (const row of all) {
    const line = row.map((cell, c) => {
      const text = String(cell ?? '');
      const pad = ' '.repeat(widths[c] - visibleLength(text));
      return c === 0 ? text + pad : pad + text;
    });
    console.log(`  ${line.join('  ')}`);
  }
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = ansi('1');
const dim = ansi('2');
const red = ansi('31');
const yellow = ansi('33');
const blue = ansi('36');
const visibleLength = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').length;

// ---- Helpers --------------------------------------------------------------------

// The usage text is the comment block at the top of this file.
function readUsage() {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines
    .slice(0, end)
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n');
}

function formatDuration(secs) {
  if (secs < 90) return `${Math.round(secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  return `${(secs / 3600).toFixed(1)} h`;
}

function mixSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function positiveInt(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) fail(`--${label} must be a whole number above 0 (got "${text}")`);
  return n;
}

function nonNegativeInt(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) fail(`--${label} needs whole numbers (got "${text}")`);
  return n;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Entry point (last, so every const above is initialised) -----------------

if (isMainThread) await main();
else parentPort.on('message', ({ tasks, timeLimit }) => parentPort.postMessage(tasks.map((t) => runTask({ ...t, timeLimit }))));
