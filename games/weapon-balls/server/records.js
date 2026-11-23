// Match records: every match the API finishes is appended as one JSON line to
// data/records/<YYYY-MM-DD>.jsonl, so real games (royales, brackets, quizzes)
// pile up into data for tools/stats.js. A record holds everything needed to
// replay the fight (seed, fighters, settings, including `shared`, which picks the
// exact math) plus who won and how.
//
// RECORDS=off turns it off; RECORDS_DIR puts the files somewhere else.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const RECORD_VERSION = 1;
export const DEFAULT_RECORDS_DIR = path.join(import.meta.dirname, '..', 'data', 'records');

const ENABLED = !/^(off|0|false|no)$/i.test(process.env.RECORDS ?? '');
const DIR = process.env.RECORDS_DIR ? path.resolve(process.env.RECORDS_DIR) : DEFAULT_RECORDS_DIR;

// The game's code version when this server started (git commit, "-dirty" with
// uncommitted changes), so stats can be split around a balance change.
const BUILD = (() => {
  try {
    return execFileSync('git', ['describe', '--always', '--dirty'], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
})();

let madeDir = false;
let writing = Promise.resolve(); // appends one at a time, in the order matches finished

// A finished match -> its record (cosmetics like colour and skin left out).
export function toRecord(match) {
  return {
    v: RECORD_VERSION,
    id: match.id,
    ref: match.ref,
    build: BUILD,
    queuedAt: match.queuedAt,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    seed: match.seed,
    settings: {
      timeLimit: match.timeLimit,
      tiebreak: match.tiebreak,
      suddenDeath: match.suddenDeath,
      royale: match.royale,
      shared: match.shared,
    },
    fighters: match.characters.map((f) => ({
      name: f.name,
      size: f.size,
      weapon: f.weapon,
      transformations: f.transformations,
      upgrades: f.upgrades,
    })),
    result: {
      winner: match.result.winner,
      reason: match.result.reason,
      time: match.result.time,
      hp: match.result.hp,
      ranking: match.result.ranking,
    },
  };
}

// Never throws: a full disk mustn't stop a match from finishing.
export function recordMatch(match) {
  if (!ENABLED || match.status !== 'done' || !match.result) return;
  const line = JSON.stringify(toRecord(match)) + '\n';
  const file = path.join(DIR, `${match.finishedAt.slice(0, 10)}.jsonl`);
  writing = writing
    .then(async () => {
      if (!madeDir) {
        await fs.promises.mkdir(DIR, { recursive: true });
        madeDir = true;
      }
      await fs.promises.appendFile(file, line);
    })
    .catch((err) => console.error(`Could not record match ${match.id}:`, err.message));
}

export const recordsInfo = { enabled: ENABLED, dir: DIR, build: BUILD };
