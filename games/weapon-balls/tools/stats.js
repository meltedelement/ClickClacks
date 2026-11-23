// Stats from real matches: reads the match records the API writes
// (data/records/*.jsonl, see server/records.js) and prints weapon win rates,
// duel matchups, and how often each upgrade and transformation is picked and
// how much it helps.
//
//   npm run stats
//   npm run stats -- --mode duel --min 10
//   npm run stats -- --weapon sword              upgrades on the sword only
//   npm run stats -- --since 2026-11-01 --build a1b2c3d
//   npm run stats -- --source royale             royale | letter-brawl | tournament | direct
//   npm run stats -- --csv fighters.csv --json stats.json
//   npm run stats -- --matches 20                the last 20 matches, with seeds
//   npm run stats -- --help
//
// Two kinds of match are counted apart, since the numbers mean different things:
// duels (two fighters: win rate, 50% is even) and royales (three or more: win
// rate against the 1/n a fighter would get by chance, and placing, where 100% is
// first, 0% first out and 50% is average). Royale bots (unnamed fighters) fight
// but aren't counted unless --bots. An upgrade's "Δ" compares fighters that had
// it with fighters of the same weapon that didn't, so a strong weapon doesn't
// make its upgrades look strong.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_RECORDS_DIR } from '../server/records.js';
import { WEAPONS } from '../src/weapons/index.js';
import { UPGRADES } from '../src/upgrades/index.js';

const HELP = `Usage: npm run stats -- [options]

  --dir <path>        records folder (default data/records, or RECORDS_DIR)
  --since <date>      only matches finished on or after this date (YYYY-MM-DD)
  --until <date>      only matches finished before this date
  --build <ids>       only these builds (git describe prefixes, comma separated)
  --source <names>    royale, letter-brawl, tournament, direct (comma separated)
  --mode <mode>       duel, royale or all (default all)
  --weapon <id>       only fighters with this weapon in the upgrade tables
  --bots              count royale bots as well
  --min <n>           hide rows with fewer fighters than this (default 5)
  --matches <n>       list the last n matches (seed, fighters, winner)
  --csv <file>        write one row per fighter per match
  --json <file>       write the tables as JSON
  -h, --help`;

const names = new Map([...WEAPONS, ...UPGRADES].map((C) => [C.id, C.displayName]));
const nameOf = (id) => names.get(id) ?? id; // records outlive renamed or removed ids

function readOptions() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      build: { type: 'string' },
      source: { type: 'string' },
      mode: { type: 'string', default: 'all' },
      weapon: { type: 'string' },
      bots: { type: 'boolean', default: false },
      min: { type: 'string', default: '5' },
      matches: { type: 'string' },
      csv: { type: 'string' },
      json: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!['duel', 'royale', 'all'].includes(values.mode)) fail('--mode must be duel, royale or all');
  return {
    ...values,
    dir: path.resolve(values.dir ?? process.env.RECORDS_DIR ?? DEFAULT_RECORDS_DIR),
    builds: values.build?.split(',').map((b) => b.trim()).filter(Boolean),
    sources: values.source?.split(',').map((s) => s.trim()).filter(Boolean),
    min: Math.max(1, Number(values.min) || 1),
    matches: values.matches === undefined ? 0 : Math.max(1, Number(values.matches) || 20),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Loading -------------------------------------------------------------------

function loadRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        records.push(JSON.parse(line));
      } catch {
        console.warn(`${file}:${i + 1}: not JSON, skipped`); // a line cut off by a crash
      }
    });
  }
  const seen = new Set(); // the same match twice (a copied file) counts once
  return records.filter((r) => r?.result && !seen.has(r.id) && seen.add(r.id)).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
}

// Which app queued the match, from its ref.
function sourceOf(record) {
  const ref = record.ref ?? '';
  if (!ref) return 'direct';
  if (ref.startsWith('royale/')) return 'royale';
  if (ref.startsWith('letter-brawl/')) return 'letter-brawl';
  if (ref.includes('/')) return 'tournament';
  return 'direct';
}

function filterRecords(records, opts) {
  return records.filter((r) => {
    const day = r.finishedAt.slice(0, 10);
    if (opts.since && day < opts.since) return false;
    if (opts.until && day >= opts.until) return false;
    if (opts.builds && !opts.builds.some((b) => (r.build ?? '').startsWith(b))) return false;
    if (opts.sources && !opts.sources.includes(sourceOf(r))) return false;
    const duel = r.fighters.length === 2;
    if (opts.mode === 'duel' && !duel) return false;
    if (opts.mode === 'royale' && duel) return false;
    return true;
  });
}

// One entry per fighter per match: what it brought and how it did.
function appearances(records, opts) {
  const rows = [];
  for (const r of records) {
    const n = r.fighters.length;
    r.fighters.forEach((f, i) => {
      const bot = r.fighters.length > 2 && r.settings.royale && f.name === null;
      if (bot && !opts.bots) return;
      const rank = r.result.ranking.indexOf(i);
      const draw = r.result.winner === null;
      rows.push({
        record: r,
        index: i,
        n,
        duel: n === 2,
        bot,
        name: f.name,
        weapon: f.weapon,
        upgrades: counts(f.upgrades),
        transformations: counts(f.transformations),
        opponent: n === 2 ? r.fighters[1 - i].weapon : null,
        // A draw shares the win; placing then follows the HP order of the ranking.
        win: draw ? 1 / n : r.result.winner === i ? 1 : 0,
        place: n > 1 ? 1 - rank / (n - 1) : 1,
        rank: rank + 1,
        hp: r.result.hp[i],
      });
    });
  }
  return rows;
}

function counts(ids = []) {
  const out = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

// ---- Tables ----------------------------------------------------------------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const signedPct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : '-');
// Half the 95% interval of a rate from n samples, so small samples look small.
const margin = (p, n) => (n > 0 ? `±${(1.96 * Math.sqrt((p * (1 - p)) / n) * 100).toFixed(0)}` : '');

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    for (const k of [].concat(key(row))) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
  }
  return groups;
}

function weaponTable(rows, duel) {
  return [...groupBy(rows, (r) => r.weapon)].map(([weapon, group]) => {
    const unmirrored = duel ? group.filter((r) => r.opponent !== weapon) : group;
    const win = mean(unmirrored.map((r) => r.win));
    return {
      weapon,
      fighters: group.length,
      share: group.length / rows.length,
      wins: group.filter((r) => r.win === 1).length,
      winRate: win,
      winMargin: margin(win, unmirrored.length),
      expected: mean(group.map((r) => 1 / r.n)),
      place: mean(group.map((r) => r.place)),
      ...(duel ? { mirrors: group.length - unmirrored.length } : {}),
    };
  });
}

// For each upgrade (or transformation): who picked it, and how they did against
// fighters of the same weapon without it.
function upgradeTable(rows, field, duel) {
  const score = (r) => (duel ? r.win : r.place);
  const byWeapon = groupBy(rows, (r) => r.weapon);
  const baseline = new Map(); // `${weapon} ${upgrade}` -> mean score of that weapon's fighters without it
  const baselineFor = (weapon, id) => {
    const key = `${weapon} ${id}`;
    if (!baseline.has(key)) baseline.set(key, mean(byWeapon.get(weapon).filter((r) => !r[field][id]).map(score)));
    return baseline.get(key);
  };
  return [...groupBy(rows, (r) => Object.keys(r[field]))].map(([id, group]) => {
    const deltas = group.map((r) => score(r) - baselineFor(r.weapon, id)).filter(Number.isFinite);
    const weapons = [...groupBy(group, (r) => r.weapon)].sort((a, b) => b[1].length - a[1].length);
    return {
      id,
      fighters: group.length,
      share: group.length / rows.length,
      copies: mean(group.map((r) => r[field][id])),
      winRate: mean(group.map((r) => r.win)),
      place: mean(group.map((r) => r.place)),
      delta: mean(deltas),
      weapons: weapons.map(([w, g]) => `${nameOf(w)} ${g.length}`).join(', '),
    };
  });
}

// Duels only: row weapon's win rate against column weapon.
function matchupTable(rows) {
  const weapons = [...new Set(rows.map((r) => r.weapon))].sort();
  const cells = {};
  for (const a of weapons) {
    cells[a] = {};
    for (const b of weapons) {
      const games = rows.filter((r) => r.weapon === a && r.opponent === b);
      cells[a][b] = games.length ? { games: games.length, winRate: mean(games.map((r) => r.win)) } : null;
    }
  }
  return { weapons, cells };
}

// ---- Printing --------------------------------------------------------------------

function printTable(headers, rows, align = []) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const cell = (v, i) => (align[i] === 'l' ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i]));
  console.log('  ' + headers.map(cell).join('  '));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) console.log('  ' + row.map(cell).join('  '));
}

function printSection(title, rows, opts, duel) {
  if (rows.length === 0) return null;
  const matches = new Set(rows.map((r) => r.record.id)).size;
  console.log(`\n━━ ${title}: ${matches} matches, ${rows.length} fighters ━━`);
  const scoreName = duel ? 'win rate' : 'placing';
  const keep = (t) => t.filter((x) => x.fighters >= opts.min);

  const weapons = keep(weaponTable(rows, duel)).sort((a, b) => (duel ? b.winRate - a.winRate : b.place - a.place));
  console.log('\nWeapons' + (duel ? ' (win rate leaves out mirror matches)' : ''));
  if (duel) {
    printTable(
      ['Weapon', 'Fighters', 'Picked', 'Wins', 'Win rate', '', 'Mirrors'],
      weapons.map((w) => [nameOf(w.weapon), w.fighters, pct(w.share), w.wins, pct(w.winRate), w.winMargin, w.mirrors]),
      ['l'],
    );
  } else {
    printTable(
      ['Weapon', 'Fighters', 'Picked', 'Wins', 'Win rate', '', 'By chance', 'Placing'],
      weapons.map((w) => [nameOf(w.weapon), w.fighters, pct(w.share), w.wins, pct(w.winRate), w.winMargin, pct(w.expected), pct(w.place)]),
      ['l'],
    );
  }

  let matchups = null;
  if (duel) {
    matchups = matchupTable(rows);
    const shown = matchups.weapons.filter((w) => weapons.some((x) => x.weapon === w));
    if (shown.length > 1) {
      console.log('\nMatchups (row\'s win rate against column, games in brackets)');
      printTable(
        ['', ...shown.map(nameOf)],
        shown.map((a) => [nameOf(a), ...shown.map((b) => (matchups.cells[a][b] ? `${pct(matchups.cells[a][b].winRate)} (${matchups.cells[a][b].games})` : '-'))]),
        ['l'],
      );
    }
  }

  const upgradeRows = opts.weapon ? rows.filter((r) => r.weapon === opts.weapon) : rows;
  const forWeapon = opts.weapon ? ` on ${nameOf(opts.weapon)}` : '';
  const tables = {};
  for (const [field, label] of [['upgrades', 'Upgrades'], ['transformations', 'Transformations']]) {
    const table = keep(upgradeTable(upgradeRows, field, duel)).sort((a, b) => b.delta - a.delta);
    tables[field] = table;
    if (table.length === 0) continue;
    console.log(`\n${label}${forWeapon} (Δ: ${scoreName} points against the same weapon without it)`);
    printTable(
      [label.slice(0, -1), 'Fighters', 'Picked', 'Copies', duel ? 'Win rate' : 'Placing', 'Δ', 'Weapons'],
      table.map((u) => [nameOf(u.id), u.fighters, pct(u.share), u.copies.toFixed(1), pct(duel ? u.winRate : u.place), signedPct(u.delta), u.weapons]),
      ['l', '', '', '', '', '', 'l'],
    );
  }
  return { matches, fighters: rows.length, weapons, matchups, ...tables };
}

function printSummary(records) {
  const sources = [...groupBy(records, sourceOf)].map(([s, g]) => `${s} ${g.length}`).join(', ');
  const builds = [...groupBy(records, (r) => r.build ?? 'unknown')].map(([b, g]) => `${b} ${g.length}`).join(', ');
  const draws = records.filter((r) => r.result.winner === null).length;
  const reasons = [...groupBy(records, (r) => r.result.reason)].map(([s, g]) => `${s} ${g.length}`).join(', ');
  console.log(`${records.length} matches from ${records[0].finishedAt.slice(0, 10)} to ${records.at(-1).finishedAt.slice(0, 10)}`);
  console.log(`  sources:  ${sources}`);
  console.log(`  builds:   ${builds}`);
  console.log(`  endings:  ${reasons}${draws ? ` (${draws} draws)` : ''}; average ${mean(records.map((r) => r.result.time)).toFixed(1)} s`);
}

function fighterText(f) {
  const extras = [...Object.entries(counts(f.transformations)), ...Object.entries(counts(f.upgrades))].map(([id, n]) => (n > 1 ? `${nameOf(id)}×${n}` : nameOf(id)));
  return `${f.name ? `${f.name}: ` : ''}${nameOf(f.weapon)}${extras.length ? ` + ${extras.join(', ')}` : ''}`;
}

function printMatches(records, n) {
  console.log(`\n━━ Last ${Math.min(n, records.length)} matches ━━`);
  for (const r of records.slice(-n)) {
    const winner = r.result.winner === null ? 'draw' : fighterText(r.fighters[r.result.winner]);
    const kind = r.fighters.length === 2 ? 'duel' : `royale of ${r.fighters.length}`;
    console.log(`\n${r.finishedAt.slice(0, 16).replace('T', ' ')}  ${kind}  seed ${r.seed}  ${r.settings.shared ? 'shared  ' : ''}id ${r.id}  ${r.ref ?? ''}`);
    if (r.fighters.length <= 4) for (const f of r.fighters) console.log(`  ${fighterText(f)}`);
    console.log(`  winner: ${winner} (${r.result.reason}, ${r.result.time.toFixed(1)} s)`);
  }
}

// ---- Exports ---------------------------------------------------------------------

function writeCsv(file, rows) {
  const quote = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const list = (o) => Object.entries(o).map(([id, n]) => (n > 1 ? `${id}:${n}` : id)).join(' ');
  const header = ['match', 'finished', 'source', 'build', 'seed', 'shared', 'fighters', 'slot', 'name', 'bot', 'weapon', 'transformations', 'upgrades', 'opponent', 'rank', 'won', 'place', 'hp', 'time', 'reason'];
  const lines = rows.map((r) =>
    [r.record.id, r.record.finishedAt, sourceOf(r.record), r.record.build ?? '', r.record.seed, r.record.settings.shared, r.n, r.index, r.name ?? '', r.bot, r.weapon, list(r.transformations), list(r.upgrades), r.opponent ?? '', r.rank, r.win, r.place.toFixed(3), r.hp, r.record.result.time, r.record.result.reason]
      .map(quote)
      .join(','),
  );
  fs.writeFileSync(file, [header.join(','), ...lines].join('\n') + '\n');
  console.log(`\nWrote ${rows.length} fighter rows to ${file}`);
}

// ---- Main ------------------------------------------------------------------------

function main() {
  const opts = readOptions();
  const all = loadRecords(opts.dir);
  if (all.length === 0) fail(`No match records in ${opts.dir} yet. They're written there as matches finish on the game's match API.`);
  const records = filterRecords(all, opts);
  if (records.length === 0) fail(`${all.length} matches recorded, but none match those filters.`);

  printSummary(records);
  const rows = appearances(records, opts);
  const out = {
    duels: opts.mode !== 'royale' ? printSection('Duels', rows.filter((r) => r.duel), opts, true) : null,
    royales: opts.mode !== 'duel' ? printSection('Royales', rows.filter((r) => !r.duel), opts, false) : null,
  };
  if (opts.matches) printMatches(records, opts.matches);
  if (opts.csv) writeCsv(opts.csv, rows);
  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify(out, null, 2) + '\n');
    console.log(`Wrote ${opts.json}`);
  }
}

main();
