// Headless balance tester. Runs a batch of matches between every pair of weapons
// across all CPU cores, then prints win rates, a matchup matrix and per-weapon
// combat stats.
//
// Usage: npm run balance -- [games] [options]
//   -g, --games N         matches per pairing (default 500, sides alternate)
//   -w, --weapons a,b,c   fighters to test (default: every weapon, no upgrades).
//                         A fighter is a weapon id, optionally with upgrades:
//                         sword+extra-blade+lifesteal. Upgrades stack: repeat
//                         an id or add :N, e.g. sword+damage:3+crit
//   -l, --list            list weapon and upgrade ids (by weapon)
//   -m, --mirror          also run mirror matches (sword vs sword, ...)
//   -t, --time-limit S    simulated seconds before a match is called a draw (default 180)
//   -s, --seed N          base seed; the same seed and options give the same results
//   -j, --jobs N          worker threads (default: CPU cores - 1)
//       --json FILE       write the full summary as JSON
//       --csv FILE        write one row per match as CSV
//   -h, --help
//
// Examples:
//   npm run balance -- 2000
//   npm run balance -- -g 5000 -w sword,mace --csv matches.csv
//   npm run balance -- -g 1000 --seed 42 --json before.json
//   npm run balance -- -g 2000 -w sword,sword+extra-blade,spear,mace,daggers
//   npm run balance -- -g 1000 -w spear,spear+crit:2+crit-damage,mace

import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { CONFIG } from '../src/config.js';
import { Simulation } from '../src/sim/Simulation.js';
import { mulberry32 } from '../src/sim/random.js';
import { WEAPONS, getWeaponById } from '../src/weapons/index.js';
import { UPGRADES, getUpgradeById, resolveUpgrades } from '../src/upgrades/index.js';

const CHUNK_SIZE = 25; // matches handed to a worker at a time
const COMEBACK_HP = 25; // a win counts as a comeback if the winner was ever this many HP behind
const FAIR_WEAPON = [0.45, 0.55]; // overall win rate a weapon should sit in
const FAIR_MATCHUP = [0.4, 0.6]; // win rate a single matchup should sit in

const DT = 1 / CONFIG.physicsHz;

// ---- Worker: running matches -------------------------------------------------

function runTask({ pairIndex, a, b, start, count, seed, timeLimit }) {
  const records = [];
  for (let game = start; game < start + count; game++) {
    const matchSeed = mixSeed(seed, hashString(`${a}|${b}`), game);
    const lineup = game % 2 === 0 ? [a, b] : [b, a];
    records.push({ pairIndex, game, ...runMatch(lineup, matchSeed, timeLimit) });
  }
  return records;
}

// `lineup` is fighter specs, e.g. ['sword+lifesteal', 'mace'].
function runMatch(lineup, seed, timeLimit) {
  // Everything random in the sim goes through Math.random, so seeding it makes matches reproducible.
  Math.random = mulberry32(seed);

  const fighters = lineup.map(() => ({
    hits: 0,
    damageDealt: 0, // HP actually removed, so no overkill
    maxHit: 0,
    parries: 0,
    blocksMade: 0, // enemy attacks stopped by this fighter's shield
    attacksBlocked: 0, // this fighter's attacks stopped by an enemy shield
    abilityUses: 0,
    abilityHits: 0,
    abilityDamage: 0,
    otherDamage: 0, // HP removed by thorns, spikes and so on rather than weapon hits
    crits: 0,
    dodges: 0, // enemy hits this fighter dodged
    worstDeficit: 0, // biggest HP lead the opponent ever had
  }));
  let firstHit = -1;

  const sim = new Simulation(lineup.map(parseFighter), { onEvent });
  const slot = (ball) => sim.balls.indexOf(ball);
  const weaponStats = ({ weapon }) => ({ damage: weapon.damage, spinSpeed: weapon.spinSpeed, length: weapon.length });
  const start = sim.balls.map(weaponStats);

  function onEvent(type, e) {
    if (type === 'hit') {
      const a = slot(e.attacker);
      const t = slot(e.target);
      const f = fighters[a];
      f.hits++;
      f.damageDealt += e.dealt;
      f.maxHit = Math.max(f.maxHit, e.damage);
      if (e.crit) f.crits++;
      if (e.attacker.weapon.ability?.active) {
        f.abilityHits++;
        f.abilityDamage += e.dealt;
      }
      if (firstHit < 0) firstHit = a;
      fighters[t].worstDeficit = Math.max(fighters[t].worstDeficit, e.attacker.hp - e.target.hp);
    } else if (type === 'damage') {
      const s = slot(e.source);
      const t = slot(e.target);
      fighters[s].damageDealt += e.dealt;
      fighters[s].otherDamage += e.dealt;
      fighters[t].worstDeficit = Math.max(fighters[t].worstDeficit, e.source.hp - e.target.hp);
    } else if (type === 'dodge') {
      fighters[slot(e.target)].dodges++;
    } else if (type === 'parry') {
      fighters[slot(e.a)].parries++;
      fighters[slot(e.b)].parries++;
    } else if (type === 'block') {
      fighters[slot(e.defender)].blocksMade++;
      fighters[slot(e.attacker)].attacksBlocked++;
    }
  }

  const abilityWasActive = sim.balls.map(() => false);
  while (!sim.over && sim.time < timeLimit) {
    sim.step(DT);
    sim.balls.forEach((ball, i) => {
      const active = ball.weapon.ability?.active ?? false;
      if (active && !abilityWasActive[i]) fighters[i].abilityUses++;
      abilityWasActive[i] = active;
    });
  }

  return {
    seed,
    time: sim.time,
    winner: sim.over && sim.winner ? slot(sim.winner) : -1,
    firstHit,
    fighters: sim.balls.map((ball, i) => ({
      id: lineup[i],
      hpLeft: ball.hp,
      ...fighters[i],
      start: start[i],
      final: weaponStats(ball),
    })),
  };
}

// ---- Main thread: scheduling, stats, output ----------------------------------

async function main() {
  const opts = readOptions();
  const pairings = buildPairings(opts.weapons, opts.mirror);
  const tasks = buildTasks(pairings, opts);
  const jobs = Math.max(1, Math.min(opts.jobs, tasks.length));
  const total = pairings.length * opts.games;

  console.log(
    `${opts.games} matches per pairing x ${pairings.length} pairings = ${total} matches` +
      `  (${jobs} workers, seed ${opts.seed}, time limit ${opts.timeLimit}s)\n`,
  );

  const started = performance.now();
  // Workers finish in any order; sort so float sums (and the CSV) don't depend on it.
  const records = (await runPool(tasks, jobs, total, started)).sort((x, y) => x.pairIndex - y.pairIndex || x.game - y.game);
  const elapsed = (performance.now() - started) / 1000;

  const summary = summarise(records, pairings, opts);
  summary.run.wallSeconds = elapsed;
  printSummary(summary);
  console.log(`\nDone in ${elapsed.toFixed(1)}s (${Math.round(total / elapsed)} matches/s).`);

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(summary, null, 2));
    console.log(`Summary written to ${opts.json}`);
  }
  if (opts.csv) {
    writeFileSync(opts.csv, toCsv(records, pairings));
    console.log(`Match log written to ${opts.csv}`);
  }
}

function readOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      games: { type: 'string', short: 'g' },
      weapons: { type: 'string', short: 'w' },
      list: { type: 'boolean', short: 'l', default: false },
      mirror: { type: 'boolean', short: 'm', default: false },
      'time-limit': { type: 'string', short: 't', default: '180' },
      seed: { type: 'string', short: 's' },
      jobs: { type: 'string', short: 'j' },
      json: { type: 'string' },
      csv: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(readUsage());
    process.exit(0);
  }

  if (values.list) {
    console.log(readList());
    process.exit(0);
  }

  const weapons = values.weapons ? values.weapons.split(',').map((spec) => spec.trim()) : WEAPONS.map((W) => W.id);
  for (const spec of weapons) {
    try {
      parseFighter(spec);
    } catch (err) {
      fail(`Bad fighter "${spec}": ${err.message}. Run with --list to see ids.`);
    }
  }
  if (new Set(weapons).size !== weapons.length) fail('A fighter is listed twice (use --mirror for mirror matches).');
  if (weapons.length < 2 && !values.mirror) fail('Need at least two weapons (or --mirror).');

  return {
    games: positiveInt(values.games ?? positionals[0] ?? '500', 'games'),
    weapons,
    mirror: values.mirror,
    timeLimit: positiveNumber(values['time-limit'], 'time-limit'),
    seed: values.seed !== undefined ? toUint32(values.seed) : (Math.random() * 2 ** 32) >>> 0,
    jobs: values.jobs ? positiveInt(values.jobs, 'jobs') : Math.max(1, availableParallelism() - 1),
    json: values.json,
    csv: values.csv,
  };
}

// The usage text is the comment block at the top of this file.
function readUsage() {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines
    .slice(0, end)
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n');
}

function readList() {
  const lines = ['Weapons:', ...WEAPONS.map((W) => `  ${W.id.padEnd(16)} ${W.displayName}`)];
  const line = (U) => {
    const notes = [U.maxStacks < Infinity && `max ${U.maxStacks}`, U.requires.length && `needs ${U.requires.join(', ')}`].filter(Boolean);
    return `  ${U.id.padEnd(16)} ${U.description}${notes.length ? `  (${notes.join('; ')})` : ''}`;
  };
  lines.push('', 'Upgrades for any weapon:', ...UPGRADES.filter((U) => U.weapons === null).map(line));
  for (const W of WEAPONS) {
    const own = UPGRADES.filter((U) => U.weapons?.includes(W.id));
    if (own.length) lines.push('', `${W.displayName} upgrades:`, ...own.map(line));
  }
  lines.push('', 'Upgrades stack: repeat an id or add :N, e.g. sword+damage:3+crit');
  return lines.join('\n');
}

// 'sword+damage:2+lifesteal' -> { weapon: 'sword', upgrades: ['damage', 'damage', 'lifesteal'] }.
// Throws if anything is unknown, doesn't fit the weapon, or breaks a stack limit or requirement.
function parseFighter(spec) {
  const [weapon, ...parts] = spec.split('+').map((part) => part.trim());
  const upgrades = parts.flatMap((part) => {
    const [id, count = '1'] = part.split(':');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`bad stack count in "${part}"`);
    return Array(n).fill(id);
  });
  resolveUpgrades(upgrades, getWeaponById(weapon).id);
  return { weapon, upgrades };
}

function fighterName(spec) {
  const { weapon, upgrades } = parseFighter(spec);
  const names = [...new Set(upgrades)].map((id) => {
    const count = upgrades.filter((x) => x === id).length;
    return getUpgradeById(id).displayName + (count > 1 ? ` x${count}` : '');
  });
  return [getWeaponById(weapon).displayName, ...names].join(' + ');
}

function buildPairings(weapons, mirror) {
  const pairings = [];
  for (let i = 0; i < weapons.length; i++) {
    for (let j = mirror ? i : i + 1; j < weapons.length; j++) pairings.push([weapons[i], weapons[j]]);
  }
  return pairings;
}

function buildTasks(pairings, { games, seed, timeLimit }) {
  const tasks = [];
  pairings.forEach(([a, b], pairIndex) => {
    for (let start = 0; start < games; start += CHUNK_SIZE) {
      tasks.push({ pairIndex, a, b, start, count: Math.min(CHUNK_SIZE, games - start), seed, timeLimit });
    }
  });
  return tasks;
}

function runPool(tasks, jobs, total, started) {
  return new Promise((resolve, reject) => {
    const records = [];
    let next = 0;
    let running = jobs;

    const progress = () => {
      if (!process.stderr.isTTY) return;
      const done = records.length;
      const secs = (performance.now() - started) / 1000;
      const eta = done ? (secs / done) * (total - done) : 0;
      const bar = '#'.repeat(Math.round((done / total) * 30)).padEnd(30, '.');
      process.stderr.write(`\r[${bar}] ${done}/${total}  ${secs.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left `);
    };

    for (let i = 0; i < jobs; i++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next < tasks.length) return worker.postMessage(tasks[next++]);
        worker.terminate();
        if (--running === 0) {
          if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
          resolve(records);
        }
      };
      worker.on('message', (batch) => {
        records.push(...batch);
        progress();
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
}

// ---- Aggregation --------------------------------------------------------------

function summarise(records, pairings, opts) {
  const ids = opts.weapons;
  const weapons = Object.fromEntries(ids.map((id) => [id, newWeaponTotals()]));
  const matchups = pairings.map(([a, b]) => ({
    a,
    b,
    mirror: a === b,
    games: 0,
    winsA: 0,
    winsB: 0,
    draws: 0,
    firstSlotWins: 0,
    firstHitWins: 0,
    comebacks: 0,
    winnerHp: 0,
    lengths: [],
  }));
  const totals = { matches: records.length, draws: 0, decided: 0, firstSlotWins: 0, firstHitWins: 0, comebacks: 0, lengths: [] };

  for (const r of records) {
    const m = matchups[r.pairIndex];
    const winner = r.fighters[r.winner];
    m.games++;
    m.lengths.push(r.time);
    totals.lengths.push(r.time);

    if (!winner) {
      m.draws++;
      totals.draws++;
    } else {
      const comeback = winner.worstDeficit >= COMEBACK_HP;
      if (m.mirror || winner.id === m.a) m.winsA++;
      else m.winsB++;
      m.winnerHp += winner.hpLeft;
      totals.decided++;
      if (r.winner === 0) {
        m.firstSlotWins++;
        totals.firstSlotWins++;
      }
      if (r.winner === r.firstHit) {
        m.firstHitWins++;
        totals.firstHitWins++;
      }
      if (comeback) {
        m.comebacks++;
        totals.comebacks++;
      }
    }

    // Per-weapon stats only count real matchups; mirrors would pull everyone towards 50%.
    if (m.mirror) continue;
    r.fighters.forEach((f, i) => {
      const w = weapons[f.id];
      const enemy = r.fighters[1 - i];
      const won = r.winner === i;
      w.games++;
      w.wins += won ? 1 : 0;
      w.draws += r.winner < 0 ? 1 : 0;
      w.comebackWins += won && f.worstDeficit >= COMEBACK_HP ? 1 : 0;
      w.hpLeftOnWin += won ? f.hpLeft : 0;
      w.damageDealt += f.damageDealt;
      w.damageTaken += enemy.damageDealt;
      w.hits += f.hits;
      w.maxHit = Math.max(w.maxHit, f.maxHit);
      w.parries += f.parries;
      w.blocksMade += f.blocksMade;
      w.attacksBlocked += f.attacksBlocked;
      w.abilityUses += f.abilityUses;
      w.abilityDamage += f.abilityDamage;
      w.otherDamage += f.otherDamage;
      w.crits += f.crits;
      w.dodges += f.dodges;
      w.firstHits += r.firstHit === i ? 1 : 0;
      w.time += r.time;
      for (const k of Object.keys(w.final)) {
        w.start[k] += f.start[k];
        w.final[k] += f.final[k];
      }
    });
  }

  const matrix = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const m of matchups) {
    if (m.mirror) continue;
    matrix[m.a][m.b] = m.winsA / m.games;
    matrix[m.b][m.a] = m.winsB / m.games;
  }

  return {
    run: { games: opts.games, weapons: ids, mirror: opts.mirror, timeLimit: opts.timeLimit, seed: opts.seed },
    totals: finishTotals(totals),
    weapons: Object.fromEntries(Object.entries(weapons).map(([id, w]) => [id, finishWeapon(w)])),
    matchups: matchups.map(finishMatchup),
    matrix,
  };
}

function newWeaponTotals() {
  return {
    games: 0, wins: 0, draws: 0, comebackWins: 0, hpLeftOnWin: 0,
    damageDealt: 0, damageTaken: 0, hits: 0, maxHit: 0,
    parries: 0, blocksMade: 0, attacksBlocked: 0,
    abilityUses: 0, abilityDamage: 0, otherDamage: 0, crits: 0, dodges: 0, firstHits: 0, time: 0,
    start: { damage: 0, spinSpeed: 0, length: 0 },
    final: { damage: 0, spinSpeed: 0, length: 0 },
  };
}

function finishWeapon(w) {
  const n = w.games || 1;
  return {
    games: w.games,
    wins: w.wins,
    draws: w.draws,
    winRate: w.wins / n,
    winRateCI: marginOfError(w.wins / n, w.games),
    hpLeftOnWin: w.wins ? w.hpLeftOnWin / w.wins : null,
    comebackWinRate: w.wins ? w.comebackWins / w.wins : null,
    firstHitRate: w.firstHits / n,
    perMatch: {
      damageDealt: w.damageDealt / n,
      damageTaken: w.damageTaken / n,
      hits: w.hits / n,
      parries: w.parries / n,
      blocksMade: w.blocksMade / n,
      attacksBlocked: w.attacksBlocked / n,
      abilityUses: w.abilityUses / n,
      crits: w.crits / n,
      dodges: w.dodges / n,
    },
    dps: w.damageDealt / (w.time || 1),
    avgHit: w.hits ? (w.damageDealt - w.otherDamage) / w.hits : 0,
    maxHit: w.maxHit,
    abilityDamageShare: w.damageDealt ? w.abilityDamage / w.damageDealt : 0,
    otherDamageShare: w.damageDealt ? w.otherDamage / w.damageDealt : 0,
    startStats: Object.fromEntries(Object.entries(w.start).map(([k, v]) => [k, v / n])),
    finalStats: Object.fromEntries(Object.entries(w.final).map(([k, v]) => [k, v / n])),
  };
}

function finishMatchup(m) {
  const decided = m.games - m.draws;
  return {
    a: m.a,
    b: m.b,
    mirror: m.mirror,
    games: m.games,
    winsA: m.winsA,
    winsB: m.winsB,
    draws: m.draws,
    winRateA: m.winsA / m.games,
    winRateB: m.winsB / m.games,
    winRateCI: marginOfError(m.winsA / m.games, m.games),
    firstSlotWinRate: decided ? m.firstSlotWins / decided : null,
    firstHitWinRate: decided ? m.firstHitWins / decided : null,
    comebackRate: decided ? m.comebacks / decided : null,
    winnerHp: decided ? m.winnerHp / decided : null,
    length: describe(m.lengths),
  };
}

function finishTotals(t) {
  return {
    matches: t.matches,
    draws: t.draws,
    firstSlotWinRate: t.decided ? t.firstSlotWins / t.decided : null,
    firstHitWinRate: t.decided ? t.firstHitWins / t.decided : null,
    comebackRate: t.decided ? t.comebacks / t.decided : null,
    length: describe(t.lengths),
  };
}

function describe(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
  return { mean, min: sorted[0] ?? 0, p10: at(0.1), median: at(0.5), p90: at(0.9), max: at(1) };
}

// Half-width of a 95% confidence interval on a proportion.
function marginOfError(p, n) {
  return n ? 1.96 * Math.sqrt((p * (1 - p)) / n) : 0;
}

// ---- Printing -------------------------------------------------------------------

function printSummary({ run, totals, weapons, matchups, matrix }) {
  const name = fighterName;
  const ids = run.weapons;

  heading('Weapons');
  table(
    ['Weapon', 'Win %', '±95%', 'Draw %', 'HP left on win', 'Comeback wins', 'First hit', ''],
    ids.map((id) => {
      const w = weapons[id];
      return [
        name(id),
        rateCell(w.winRate, FAIR_WEAPON),
        pctText(w.winRateCI),
        pctText(w.draws / (w.games || 1)),
        num(w.hpLeftOnWin),
        pctText(w.comebackWinRate),
        pctText(w.firstHitRate),
        verdict(w.winRate, w.winRateCI, FAIR_WEAPON),
      ];
    }),
  );

  heading('Combat (averages per match)');
  table(
    ['Weapon', 'Dmg dealt', 'Dmg taken', 'DPS', 'Hits', 'Avg hit', 'Max hit', 'Parries', 'Blocks', 'Got blocked', 'Ability uses', 'Ability dmg', 'Other dmg', 'Crits', 'Dodges'],
    ids.map((id) => {
      const w = weapons[id];
      const p = w.perMatch;
      return [
        name(id),
        num(p.damageDealt),
        num(p.damageTaken),
        num(w.dps, 2),
        num(p.hits),
        num(w.avgHit, 2),
        num(w.maxHit),
        num(p.parries),
        num(p.blocksMade),
        num(p.attacksBlocked),
        num(p.abilityUses),
        pctText(w.abilityDamageShare),
        pctText(w.otherDamageShare),
        num(p.crits),
        num(p.dodges),
      ];
    }),
  );

  heading('Scaling (weapon stats at end of match, avg)');
  table(
    ['Weapon', 'Damage', 'Spin speed', 'Length', 'Start dmg', 'Start spin', 'Start len'],
    ids.map((id) => {
      const f = weapons[id].finalStats;
      const s = weapons[id].startStats;
      return [name(id), num(f.damage, 2), num(f.spinSpeed, 2), num(f.length), num(s.damage, 2), num(s.spinSpeed, 2), num(s.length)];
    }),
  );

  if (ids.length > 1) {
    heading('Win matrix (row beats column)');
    table(
      ['', ...ids.map(name)],
      ids.map((row) => [name(row), ...ids.map((col) => (row === col ? dim('—') : rateCell(matrix[row][col], FAIR_MATCHUP)))]),
    );
  }

  heading('Matchups');
  table(
    ['Matchup', 'A win %', 'B win %', '±95%', 'Draw %', 'Avg len', 'Median', 'p10–p90', 'Winner HP', 'First-hit wins', 'Comebacks', 'Slot 1 wins'],
    matchups.map((m) => [
      m.mirror ? `${name(m.a)} mirror` : `${name(m.a)} vs ${name(m.b)}`,
      m.mirror ? dim('—') : rateCell(m.winRateA, FAIR_MATCHUP),
      m.mirror ? dim('—') : rateCell(m.winRateB, FAIR_MATCHUP),
      m.mirror ? dim('—') : pctText(m.winRateCI),
      pctText(m.draws / m.games),
      `${num(m.length.mean)}s`,
      `${num(m.length.median)}s`,
      `${num(m.length.p10, 0)}–${num(m.length.p90, 0)}s`,
      num(m.winnerHp),
      pctText(m.firstHitWinRate),
      pctText(m.comebackRate),
      pctText(m.firstSlotWinRate),
    ]),
  );

  heading('Overall');
  const l = totals.length;
  console.log(`  Matches           ${totals.matches}  (${totals.draws} draws)`);
  console.log(`  Match length      avg ${num(l.mean)}s, median ${num(l.median)}s, range ${num(l.min)}–${num(l.max)}s`);
  console.log(`  First hit -> win  ${pctText(totals.firstHitWinRate)}  (high = snowbally, 50% = first hit means nothing)`);
  console.log(`  Comeback wins     ${pctText(totals.comebackRate)}  (winner was ${COMEBACK_HP}+ HP behind at some point)`);
  console.log(`  Slot 1 win rate   ${pctText(totals.firstSlotWinRate)}  (spawn side bias, should be ~50%)`);
}

function verdict(rate, ci, [lo, hi]) {
  if (rate - ci > hi) return red('strong');
  if (rate + ci < lo) return blue('weak');
  if (rate > hi || rate < lo) return dim('maybe off, run more games');
  return green('ok');
}

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

function rateCell(rate, [lo, hi]) {
  const text = pctText(rate);
  if (rate > hi) return red(text);
  if (rate < lo) return blue(text);
  return text;
}

function pctText(p) {
  return p == null ? '-' : `${(p * 100).toFixed(1)}%`;
}

function num(v, digits = 1) {
  return v == null ? '-' : v.toFixed(digits);
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = ansi('1');
const dim = ansi('2');
const red = ansi('31');
const green = ansi('32');
const blue = ansi('36');
const visibleLength = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').length;

// ---- CSV ------------------------------------------------------------------------

function toCsv(records, pairings) {
  const perFighter = ['id', 'hpLeft', 'damageDealt', 'hits', 'maxHit', 'parries', 'blocksMade', 'attacksBlocked', 'abilityUses', 'abilityDamage', 'otherDamage', 'crits', 'dodges', 'worstDeficit'];
  const finals = ['damage', 'spinSpeed', 'length'];
  const fighterCols = (p) => [...perFighter, ...finals.map((k) => `final_${k}`)].map((k) => `${p}_${k}`);
  const header = ['matchup', 'game', 'seed', 'time', 'winner', 'first_hit', ...fighterCols('p1'), ...fighterCols('p2')];

  const rows = records.map((r) => {
    const [a, b] = pairings[r.pairIndex];
    const winner = r.fighters[r.winner]?.id ?? 'draw';
    const firstHit = r.fighters[r.firstHit]?.id ?? '';
    const fighter = (f) => [...perFighter.map((k) => round(f[k])), ...finals.map((k) => round(f.final[k]))];
    return [`${a}-vs-${b}`, r.game, r.seed, round(r.time), winner, firstHit, ...fighter(r.fighters[0]), ...fighter(r.fighters[1])];
  });
  return [header, ...rows].map((row) => row.join(',')).join('\n') + '\n';
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

// ---- Helpers --------------------------------------------------------------------

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

function toUint32(text) {
  const n = Number(text);
  return Number.isFinite(n) ? n >>> 0 : hashString(text);
}

function positiveInt(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) fail(`--${label} must be a whole number above 0 (got "${text}")`);
  return n;
}

function positiveNumber(text, label) {
  const n = Number(text);
  if (!(n > 0)) fail(`--${label} must be a number above 0 (got "${text}")`);
  return n;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Entry point (last, so every const above is initialised) -----------------

if (isMainThread) await main();
else parentPort.on('message', (task) => parentPort.postMessage(runTask(task)));
