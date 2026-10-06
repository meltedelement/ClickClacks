// The match API: another program (such as the tournament service in
// tournament/ at the repo root) queues matches over HTTP, a display page plays
// them live, and the result goes back to whoever asked. The display decides the
// official result, so what's on screen is always what gets recorded. Types for
// callers are in api/game.d.ts. This is the game's Match Host API
// (contracts/match-host.d.ts at the repo root): callers that know nothing about
// the game use only what that contract describes.
//
// For the tournament program:
//   GET    /api/catalog               weapons, upgrades and transformations the game knows
//   GET    /api/status                displays connected, matches on screen, queue length
//   POST   /api/validate              check characters without queueing anything
//   POST   /api/matches               queue a match (two characters or more) -> the match (201)
//   GET    /api/matches               every match this server has seen; ?ref= and ?status= filter
//   GET    /api/matches/:id           one match; add ?wait=1 to hold the request until it's done
//   DELETE /api/matches/:id           cancel a match that isn't done yet
// For the display page (src/ui/TournamentDisplay.js):
//   GET    /api/display               server-sent events: the match on each screen (or null)
//   POST   /api/matches/:id/start     the display started playing it
//   POST   /api/matches/:id/result    the display finished it
//
// The display page is split into SCREENS arenas (default 4, set with the
// SCREENS environment variable, 1 to 4). Each screen plays one match; a free
// screen takes the next match in the order they were queued. Every connected
// display plays the same matches on the same screens; they all show the same
// fights because the matches are seeded. The first result in counts. If the
// last display disconnects, the matches on screen go back to queued and restart
// from the beginning (same seed, same fight) when a display comes back.
//
// State lives in memory only: restarting the server forgets every match.
import { randomUUID } from 'node:crypto';
import { CONFIG } from '../src/config.js';
import { WEAPONS, getWeaponById } from '../src/weapons/index.js';
import { UPGRADES, getUpgradeById, resolveUpgrades } from '../src/upgrades/index.js';

const DEFAULT_TIME_LIMIT = 180; // sim seconds before a match is called a draw (same as the balance tool)
const MAX_TIME_LIMIT = 600;
const MAX_BODY = 64 * 1024;
const MAX_COUNT = 100; // copies of one upgrade in the { id: count } form, whatever its maxStacks
const HEX_COLOR = /^#[0-9a-f]{6}$/i; // a fighter's ball colour, e.g. a quiz team's colour
const MAX_REF = 200; // characters in a caller's `ref` tag
const PING_INTERVAL = 20_000; // keeps display connections open through proxies
const MAX_SCREENS = 4; // the display lays out at most a 2×2 grid
const SCREENS = Math.min(MAX_SCREENS, Math.max(1, Math.floor(Number(process.env.SCREENS ?? MAX_SCREENS)) || 1));
const TIEBREAKS = new Set(['hp']);

const matches = new Map(); // id -> match, in the order they were queued
const queue = []; // matches not yet done, in the order they were queued
const screens = Array(SCREENS).fill(null); // the match on each screen, or null
const displays = new Set(); // open /api/display responses
const waiters = new Map(); // match id -> callbacks for ?wait=1 requests

setInterval(() => {
  for (const res of displays) res.write(': ping\n\n');
}, PING_INTERVAL).unref();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Handles /api/* requests. Returns false for anything else so the caller can
// serve it (static files, Vite).
export async function handleApi(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  // Allow calls from other local pages (e.g. the quiz admin page).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return true;
  }

  try {
    await route(req, res, url);
  } catch (err) {
    if (err instanceof ApiError) json(res, err.status, { error: err.message });
    else {
      console.error(err);
      json(res, 500, { error: 'Server error' });
    }
  }
  return true;
}

async function route(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, id, action] = parts;
  const method = req.method;

  if (method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, catalog());
  if (method === 'GET' && url.pathname === '/api/status') return json(res, 200, status());
  if (method === 'GET' && url.pathname === '/api/display') return openDisplay(req, res);
  if (url.pathname === '/api/validate') {
    if (method !== 'POST') throw new ApiError(405, 'Use POST');
    return json(res, 200, validate(await readBody(req)));
  }

  if (resource !== 'matches' || parts.length > 3) throw new ApiError(404, 'Not found');

  if (!id) {
    if (method === 'GET') return json(res, 200, listMatches(url.searchParams));
    if (method === 'POST') return json(res, 201, queueMatch(await readBody(req)));
    throw new ApiError(405, 'Use GET or POST');
  }

  const match = matches.get(id);
  if (!match) throw new ApiError(404, `No match with id "${id}"`);

  if (!action) {
    if (method === 'GET') {
      const wait = url.searchParams.get('wait');
      if (wait && wait !== '0' && wait !== 'false' && !isFinished(match)) return waitFor(req, res, match);
      return json(res, 200, match);
    }
    if (method === 'DELETE') return json(res, 200, cancel(match));
    throw new ApiError(405, 'Use GET or DELETE');
  }

  if (method !== 'POST') throw new ApiError(405, 'Use POST');
  if (action === 'start') return json(res, 200, start(match));
  if (action === 'result') return json(res, 200, finish(match, await readBody(req)));
  throw new ApiError(404, 'Not found');
}

// ---- Tournament side -----------------------------------------------------------

function catalog() {
  const describe = (U) => ({
    id: U.id,
    name: U.displayName,
    description: U.description,
    weapons: U.weapons,
    requires: U.requires,
    excludedBy: U.excludedBy,
    maxStacks: Number.isFinite(U.maxStacks) ? U.maxStacks : null,
  });
  return {
    weapons: WEAPONS.map((W) => ({ id: W.id, name: W.displayName })),
    upgrades: UPGRADES.filter((U) => !U.transformation).map(describe),
    transformations: UPGRADES.filter((U) => U.transformation).map(describe),
  };
}

function status() {
  const onScreen = screens.filter(Boolean);
  return {
    displays: displays.size,
    screens: SCREENS,
    onScreen,
    queued: queue.length,
    displayPath: '/?display',
  };
}

// ?ref= keeps the matches a caller tagged that way, ?status= those in that status.
function listMatches(params) {
  const ref = params.get('ref');
  const status = params.get('status');
  return [...matches.values()].filter((match) => (ref === null || match.ref === ref) && (status === null || match.status === status));
}

// Checks characters (and settings, if sent) the way POST /api/matches does,
// without queueing anything, so a caller can check a loadout without knowing
// the game's rules.
function validate(body) {
  if (!Array.isArray(body.characters)) throw new ApiError(400, '"characters" must be an array of characters');
  let settings = null;
  try {
    parseSettings(body);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    settings = err.message;
  }
  return {
    characters: body.characters.map((input, i) => {
      try {
        parseFighter(input, i);
        return { valid: true, error: null };
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        return { valid: false, error: err.message.replace(/^characters\[\d+\](: |\.| )/, '') };
      }
    }),
    settings,
  };
}

function queueMatch(body) {
  if (!Array.isArray(body.characters) || body.characters.length < 2) {
    throw new ApiError(400, '"characters" must be an array of two characters or more');
  }
  const match = {
    id: randomUUID(),
    ref: parseRef(body.ref),
    status: 'queued',
    characters: body.characters.map(parseFighter),
    seed: body.seed === undefined ? Math.floor(Math.random() * 2 ** 32) : parseSeed(body.seed),
    ...parseSettings(body),
    screen: null,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
  };
  matches.set(match.id, match);
  queue.push(match);
  if (fillScreens()) broadcast();
  return match;
}

// Puts the next queued matches on the free screens. Returns true if any moved.
function fillScreens() {
  let changed = false;
  for (let i = 0; i < screens.length; i++) {
    if (screens[i]) continue;
    const next = queue.find((match) => match.screen === null);
    if (!next) break;
    next.screen = i;
    screens[i] = next;
    changed = true;
  }
  return changed;
}

// The match settings: `settings` { timeLimit?, tiebreak?, suddenDeath? }.
// `decisive: true` asks for a winner, which is the hp tiebreak.
function parseSettings(body) {
  if (body.settings !== undefined && (body.settings === null || typeof body.settings !== 'object' || Array.isArray(body.settings))) {
    throw new ApiError(400, '"settings" must be an object');
  }
  if (body.decisive !== undefined && typeof body.decisive !== 'boolean') throw new ApiError(400, '"decisive" must be true or false');
  const settings = body.settings ?? {};
  return {
    timeLimit: settings.timeLimit === undefined ? DEFAULT_TIME_LIMIT : parseTimeLimit(settings.timeLimit),
    tiebreak: body.decisive ? 'hp' : parseTiebreak(settings.tiebreak),
    suddenDeath: settings.suddenDeath === undefined ? CONFIG.suddenDeath.after : parseSuddenDeath(settings.suddenDeath),
  };
}

// A character is a fighter: { name?, color?, weapon, upgrades?, transformations? }. `team` is
// accepted in place of `name`, and upgrades and transformations may each be a
// list of ids (repeat an id to stack it) or an { id: count } object, so the
// quiz's loadouts can be passed straight in. Transformations go only in
// `transformations`, and every other upgrade only in `upgrades`.
function parseFighter(input, i) {
  const where = `characters[${i}]`;
  if (!input || typeof input !== 'object') throw new ApiError(400, `${where} must be an object`);

  const name = input.name ?? input.team ?? null;
  if (name !== null && typeof name !== 'string') throw new ApiError(400, `${where}.name must be a string`);
  const color = input.color ?? null;
  if (color !== null && !(typeof color === 'string' && HEX_COLOR.test(color))) {
    throw new ApiError(400, `${where}.color must be a hex colour like "#e5484d"`);
  }

  const upgrades = parseUpgradeIds(input.upgrades ?? [], `${where}.upgrades`);
  const transformations = parseUpgradeIds(input.transformations ?? [], `${where}.transformations`);
  try {
    const WeaponClass = getWeaponById(input.weapon);
    for (const id of upgrades) {
      if (getUpgradeById(id).transformation) throw new Error(`"${id}" is a transformation: put it in "transformations"`);
    }
    for (const id of transformations) {
      if (!getUpgradeById(id).transformation) throw new Error(`"${id}" is not a transformation: put it in "upgrades"`);
    }
    resolveUpgrades([...transformations, ...upgrades], WeaponClass.id);
  } catch (err) {
    throw new ApiError(400, `${where}: ${err.message}`);
  }
  return { name, color, weapon: input.weapon, upgrades, transformations };
}

function parseUpgradeIds(upgrades, where) {
  if (Array.isArray(upgrades)) {
    if (!upgrades.every((id) => typeof id === 'string')) throw new ApiError(400, `${where} must be upgrade ids`);
    return upgrades;
  }
  if (!upgrades || typeof upgrades !== 'object') throw new ApiError(400, `${where} must be a list or an { id: count } object`);
  return Object.entries(upgrades).flatMap(([id, count]) => {
    if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
      throw new ApiError(400, `${where}.${id} must be a whole number from 0 to ${MAX_COUNT}`);
    }
    return Array(count).fill(id);
  });
}

function parseRef(ref) {
  if (ref === undefined || ref === null) return null;
  if (typeof ref !== 'string' || ref.length > MAX_REF) throw new ApiError(400, `"ref" must be a string of at most ${MAX_REF} characters`);
  return ref;
}

function parseSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) throw new ApiError(400, '"seed" must be a whole number from 0 to 2^32 - 1');
  return seed;
}

function parseTimeLimit(timeLimit) {
  if (typeof timeLimit !== 'number' || !(timeLimit > 0 && timeLimit <= MAX_TIME_LIMIT)) {
    throw new ApiError(400, `"timeLimit" must be a number of seconds above 0 and at most ${MAX_TIME_LIMIT}`);
  }
  return timeLimit;
}

// Sim seconds before sudden death starts, or null for none.
function parseSuddenDeath(suddenDeath) {
  if (suddenDeath === null) return null;
  if (typeof suddenDeath !== 'number' || !(suddenDeath >= 0 && suddenDeath <= MAX_TIME_LIMIT)) {
    throw new ApiError(400, `"suddenDeath" must be null or a number of seconds from 0 to ${MAX_TIME_LIMIT}`);
  }
  return suddenDeath;
}

// null (a draw is possible) or 'hp' (the fighter with the most HP left wins at the time limit).
function parseTiebreak(tiebreak) {
  if (tiebreak === undefined || tiebreak === null) return null;
  if (!TIEBREAKS.has(tiebreak)) throw new ApiError(400, '"tiebreak" must be "hp" or null');
  return tiebreak;
}

// A finished match keeps its `screen` number as a record, so check the screen itself.
function isOnScreen(match) {
  return match.screen !== null && screens[match.screen] === match;
}

function isFinished(match) {
  return match.status === 'done' || match.status === 'cancelled';
}

// Holds the request open until the match is done or cancelled.
function waitFor(req, res, match) {
  const reply = () => json(res, 200, match);
  const list = waiters.get(match.id) ?? [];
  list.push(reply);
  waiters.set(match.id, list);
  req.socket.setTimeout(0); // matches can take minutes
  res.on('close', () => {
    const remaining = (waiters.get(match.id) ?? []).filter((fn) => fn !== reply);
    if (remaining.length > 0) waiters.set(match.id, remaining);
    else waiters.delete(match.id);
  });
}

function cancel(match) {
  if (isFinished(match)) throw new ApiError(409, `Match is already ${match.status}`);
  match.status = 'cancelled';
  match.finishedAt = new Date().toISOString();
  settle(match);
  return match;
}

// Takes a match that just finished off the queue and its screen, and tells everyone who cares.
function settle(match) {
  queue.splice(queue.indexOf(match), 1);
  const wasOnScreen = isOnScreen(match);
  if (wasOnScreen) screens[match.screen] = null;
  for (const reply of waiters.get(match.id) ?? []) reply();
  waiters.delete(match.id);
  if (wasOnScreen) {
    fillScreens();
    broadcast();
  }
}

// ---- Display side --------------------------------------------------------------

function openDisplay(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  req.socket.setTimeout(0);
  displays.add(res);
  send(res);
  res.on('close', () => {
    displays.delete(res);
    if (displays.size > 0) return;
    // Nobody is watching the matches any more; play them again from the start later.
    for (const match of screens) {
      if (match?.status !== 'playing') continue;
      match.status = 'queued';
      match.startedAt = null;
    }
  });
}

// One message holds every screen, so a display never sees half an update.
function send(res) {
  res.write(`data: ${JSON.stringify({ screens })}\n\n`);
}

function broadcast() {
  for (const res of displays) send(res);
}

function start(match) {
  if (!isOnScreen(match)) throw new ApiError(409, 'That match is not on screen');
  if (match.status === 'queued') {
    match.status = 'playing';
    match.startedAt = new Date().toISOString();
  }
  return match;
}

// Body: { winner: fighter index or null for a draw, time: sim seconds, hp: [hp left per fighter],
//         decidedBy?: 'ko' | 'hp' (how the winner was found),
//         ranking?: [fighter indices, first place first] }
function finish(match, body) {
  if (match.status === 'done') return match; // another display got there first
  if (!isOnScreen(match)) throw new ApiError(409, 'That match is not on screen');

  const { winner, time, hp, decidedBy = 'ko', ranking = defaultRanking(match, winner, hp) } = body;
  if (decidedBy !== 'ko' && decidedBy !== 'hp') throw new ApiError(400, '"decidedBy" must be "ko" or "hp"');
  if (decidedBy === 'hp' && (winner === null || match.tiebreak !== 'hp')) {
    throw new ApiError(400, '"decidedBy": "hp" needs a winner and a match with the hp tiebreak');
  }
  if (winner !== null && !(Number.isInteger(winner) && winner >= 0 && winner < match.characters.length)) {
    throw new ApiError(400, '"winner" must be a character index or null');
  }
  if (typeof time !== 'number') throw new ApiError(400, '"time" must be a number');
  if (!Array.isArray(hp) || hp.length !== match.characters.length) throw new ApiError(400, '"hp" must have one number per character');
  const indices = match.characters.map((_, i) => i);
  if (!Array.isArray(ranking) || ranking.length !== indices.length || !indices.every((i) => ranking.includes(i)) || (winner !== null && ranking[0] !== winner)) {
    throw new ApiError(400, '"ranking" must list every character index once, the winner first');
  }

  match.status = 'done';
  match.startedAt ??= new Date().toISOString();
  match.finishedAt = new Date().toISOString();
  match.result = {
    winner,
    winnerName: winner === null ? null : (match.characters[winner].name ?? match.characters[winner].weapon),
    reason: decidedBy === 'hp' ? 'hp' : winner === null && time >= match.timeLimit ? 'time' : 'ko',
    time,
    hp,
    scores: hp, // the Match Host's tiebreak score
    ranking,
  };
  settle(match);
  return match;
}

// For a display that doesn't send a ranking: the winner, then the others by HP left.
function defaultRanking(match, winner, hp) {
  if (!Array.isArray(hp)) return undefined;
  return match.characters
    .map((_, i) => i)
    .sort((a, b) => (b === winner) - (a === winner) || (hp[b] ?? 0) - (hp[a] ?? 0) || a - b);
}

// ---- HTTP helpers --------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new ApiError(413, 'Request body too large');
  }
  if (!raw) return {};
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new ApiError(400, 'Body must be a JSON object');
}
