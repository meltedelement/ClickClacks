// Flawless finder: plays seeded matches headlessly until one is won by a fighter
// that never got hit, then prints its fighters and seed so it can be replayed on
// the display page through the match API (the same seed and fighters give the
// same fight).
//
// Plain weapons almost never win flawless, so by default each match is between
// random builds (a random weapon, 0 to --upgrades upgrades and 0 to
// --transformations transformations each), which makes lopsided fights common.
// Give -w to search only fights between the fighters you list: "any" in the
// list is a random build, and a "*" in front marks a fighter that must be the
// one to win flawless.
//
// "Never got hit" means no enemy weapon hit landed and no HP was lost to
// anything else either (thorns, burns, spikes, sudden death...). Dodged hits and
// hits stopped by a shield don't count. --hits-only counts weapon hits alone.
//
// Usage: node tools/flawless.js [options]      (npm run flawless -- [options])
//   -w, --weapons a,b,c   fighters to pick from, as in the balance tool
//                         (sword+damage:3+crit). "any" is a random build, and
//                         "*" in front (quote it: '*sword,any') means that
//                         fighter must be the winner. Default: random builds
//   -u, --upgrades N      most upgrade copies per random build (default 6)
//   -x, --transformations N
//                         most transformations per random build (default 1)
//   -f, --fighters N      fighters per match; more than two is a free-for-all (default 2)
//   -n, --count N         stop after finding this many (default 1)
//   -m, --max N           give up after this many matches (default 200000)
//       --hits-only       only enemy weapon hits count, not other damage
//   -t, --time-limit S    simulated seconds before a match is called a draw (default 180)
//   -d, --sudden-death S  simulated seconds before sudden death starts, or "off"
//                         (default: CONFIG.suddenDeath.after)
//   -s, --seed N          base seed; the same seed and options find the same matches
//   -j, --jobs N          worker threads (default: CPU cores - 1)
//   -q, --queue [URL]     queue each find on the game's match API so an open
//                         ?display page plays it (default http://localhost:5173)
//   -h, --help
//
// Examples:
//   npm run flawless
//   npm run flawless -- -n 5 -s 1
//   npm run flawless -- -w sword+damage:5,daggers,spear
//   npm run flawless -- -w '*sword,any'          a plain sword beating a random build
//   npm run flawless -- -f 4 --queue
//   npm run flawless -- --queue http://localhost:3002

import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { CONFIG } from '../src/config.js';
import { CHUNK_SIZE, MAX_API_TIME_LIMIT, collect, entryText, matchRequest, parseEntry, runTask } from '../src/flawless/search.js';

// The search itself is in src/flawless/search.js, shared with the finder page (flawless.html).

const DEFAULT_QUEUE_URL = 'http://localhost:5173';

// ---- Main thread: scheduling and output -------------------------------------------

async function main() {
  const opts = readOptions();
  const jobs = Math.max(1, Math.min(opts.jobs, Math.ceil(opts.max / CHUNK_SIZE)));
  const pool = opts.entries ? `fighters from ${opts.entries.map(entryText).join(', ')}` : `random builds (up to ${opts.upgrades} upgrades, ${opts.transformations} transformations)`;
  console.log(
    `Looking for ${opts.count} flawless win${opts.count > 1 ? 's' : ''} in up to ${opts.max} matches of ${opts.fighters} ${pool}` +
      `  (${jobs} workers, seed ${opts.seed}${opts.hitsOnly ? ', weapon hits only' : ''})\n`,
  );

  const started = performance.now();
  const { found, closest, played } = await search(opts, jobs, started);
  const secs = (performance.now() - started) / 1000;

  if (!found.length) {
    console.log(`No flawless win in ${played} matches (${secs.toFixed(1)}s).`);
    if (closest) {
      console.log(`\nClosest: the winner took ${closest.taken} hit${closest.taken > 1 ? 's' : ''}.`);
      printFind(closest, opts);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Found ${found.length} in ${played} matches (${secs.toFixed(1)}s).`);
  for (const [i, find] of found.entries()) {
    console.log(`\n#${i + 1}`);
    printFind(find, opts);
    if (opts.queue) await queue(find, opts);
  }
  if (!opts.queue) console.log(`\nTo watch one: open ${DEFAULT_QUEUE_URL}/?display and rerun with --queue (or POST the body above to /api/matches).`);
}

// Hands chunks of match indices to the workers in order. Finds are kept in
// index order, and the search only stops at a chunk boundary once every chunk
// before it is in, so the same seed always reports the same matches.
function search(opts, jobs, started) {
  return new Promise((resolve, reject) => {
    const results = new Map(); // chunk start -> result
    let next = 0;
    let played = 0;
    let running = jobs;
    let done = false;

    const progress = () => {
      if (!process.stderr.isTTY) return;
      const secs = (performance.now() - started) / 1000;
      const hits = [...results.values()].reduce((n, r) => n + r.found.length, 0);
      process.stderr.write(`\r${played} matches, ${hits} flawless, ${secs.toFixed(0)}s `);
    };

    for (let i = 0; i < jobs; i++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (!done && next < opts.max) {
          worker.postMessage({ start: next, count: Math.min(CHUNK_SIZE, opts.max - next), opts });
          next += CHUNK_SIZE;
          return;
        }
        worker.terminate();
        if (--running === 0) {
          if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
          resolve(collect(results, opts.count));
        }
      };
      worker.on('message', (result) => {
        results.set(result.start, result);
        played += result.count;
        progress();
        if (collect(results, opts.count).found.length >= opts.count) done = true;
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
}

function printFind(find, opts) {
  find.specs.forEach((spec, i) => console.log(`  ${i === find.winner ? 'winner' : '      '}  ${spec}${find.random[i] ? '  (any)' : ''}`));
  console.log(`  seed ${find.seed}, won in ${find.time.toFixed(1)}s with ${round(find.hp)}/${round(find.maxHp)} HP`);
  console.log(`  ${JSON.stringify(matchRequest(find, opts))}`);
}

async function queue(find, opts) {
  try {
    const res = await fetch(`${opts.queue}/api/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...matchRequest(find, opts), ref: `flawless/${find.seed}` }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    console.log(`  Queued as match ${body.id}. Open ${opts.queue}/?display to watch it.`);
  } catch (err) {
    console.error(`  Could not queue it on ${opts.queue}: ${err.message}`);
    process.exitCode = 1;
  }
}

function readOptions() {
  // --queue takes an optional URL: a bare --queue (or one followed by another option) means the default.
  const argv = process.argv.slice(2);
  const q = argv.findIndex((a) => a === '--queue' || a === '-q');
  if (q >= 0 && (q === argv.length - 1 || argv[q + 1].startsWith('-'))) argv.splice(q + 1, 0, DEFAULT_QUEUE_URL);

  const { values } = parseArgs({
    args: argv,
    options: {
      weapons: { type: 'string', short: 'w' },
      upgrades: { type: 'string', short: 'u', default: '6' },
      transformations: { type: 'string', short: 'x', default: '1' },
      fighters: { type: 'string', short: 'f', default: '2' },
      count: { type: 'string', short: 'n', default: '1' },
      max: { type: 'string', short: 'm', default: '200000' },
      'hits-only': { type: 'boolean', default: false },
      'time-limit': { type: 'string', short: 't', default: '180' },
      'sudden-death': { type: 'string', short: 'd' },
      seed: { type: 'string', short: 's' },
      jobs: { type: 'string', short: 'j' },
      queue: { type: 'string', short: 'q' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(readUsage());
    process.exit(0);
  }

  const entries = values.weapons?.split(',').map(entryOrFail) ?? null;
  const timeLimit = positiveNumber(values['time-limit'], 'time-limit');
  if (values.queue && timeLimit > MAX_API_TIME_LIMIT) fail(`--queue needs a --time-limit of at most ${MAX_API_TIME_LIMIT} (the match API's limit)`);

  return {
    entries,
    upgrades: nonNegativeInt(values.upgrades, 'upgrades'),
    transformations: nonNegativeInt(values.transformations, 'transformations'),
    fighters: Math.max(2, positiveInt(values.fighters, 'fighters')),
    count: positiveInt(values.count, 'count'),
    max: positiveInt(values.max, 'max'),
    hitsOnly: values['hits-only'],
    timeLimit,
    suddenDeath: readSuddenDeath(values['sudden-death']),
    seed: values.seed !== undefined ? Number(values.seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0,
    jobs: values.jobs ? positiveInt(values.jobs, 'jobs') : Math.max(1, availableParallelism() - 1),
    queue: values.queue?.replace(/\/+$/, ''),
  };
}

function entryOrFail(text) {
  try {
    return parseEntry(text);
  } catch (err) {
    fail(`Bad fighter "${text}": ${err.message}. Run npm run balance -- --list to see ids.`);
  }
}

function readSuddenDeath(text) {
  if (text === undefined) return CONFIG.suddenDeath.after;
  if (text === 'off') return null;
  return positiveNumber(text, 'sudden-death');
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

const round = (n) => Math.round(n * 10) / 10;

function positiveInt(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) fail(`--${label} must be a whole number above 0 (got "${text}")`);
  return n;
}

function nonNegativeInt(text, label) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) fail(`--${label} must be a whole number (got "${text}")`);
  return n;
}

function positiveNumber(text, label) {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) fail(`--${label} must be a number above 0 (got "${text}")`);
  return n;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Entry point (last, so every const above is initialised) -----------------

if (isMainThread) await main();
else parentPort.on('message', (task) => parentPort.postMessage(runTask(task)));
