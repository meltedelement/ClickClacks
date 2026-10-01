// The Tournament API over HTTP, with server-sent events. No dependencies: run
// with `node server/index.ts`. Routes are documented in ../README.md and typed
// in ../../api/tournament.d.ts.
//
//   GET    /api/formats                           the formats and their options
//   GET    /api/formats/:id/plan?entrants=8       the stages a tournament of that size has
//   POST   /api/tournaments                       draw a tournament -> the tournament (201)
//   GET    /api/tournaments                       every tournament
//   GET    /api/tournaments/:id                   one; ?wait=<version> holds until it is newer
//   DELETE /api/tournaments/:id                   delete it, taking its matches off the game
//   GET    /api/tournaments/:id/events            server-sent events: the tournament on every change
//   PATCH  /api/tournaments/:id/entrants          change names, colours and loadouts
//   POST   /api/tournaments/:id/start             start the current stage
//   POST   /api/tournaments/:id/stop              stop the current stage
//   POST   /api/tournaments/:id/matches/:m/replay play a match again
//   POST   /api/tournaments/:id/matches/:m/winner decide a match
//   GET    /api/game                              the game this service plays on
//   GET    /api/game/catalog                      the game's weapons, upgrades and transformations
//
// It listens on 127.0.0.1 unless HOST says otherwise: callers are other
// programs on this machine (the quiz server), and nothing here checks who asks.
import http from 'node:http';
import type { Catalog } from '../../api/game.d.ts';
import type { Tournament } from '../../api/tournament.d.ts';
import { plan } from '../formats/common.ts';
import { FORMATS, formatInfo, getFormat, resolveOptions } from '../formats/index.ts';
import * as game from './game.ts';
import * as runner from './runner.ts';
import * as store from './store.ts';
import { ApiError } from './store.ts';

const PORT = Number(process.env.PORT ?? 3003);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY = 256 * 1024;
const PING_MS = 20_000; // keeps event streams open through proxies
const GAME_PING_MS = 2_000;

// Open event streams and long polls, per tournament id.
const streams = new Map<string, Set<http.ServerResponse>>();
const waiters = new Map<string, Set<(t: Tournament | null) => void>>();

store.onChange((t, removed) => {
  for (const res of streams.get(t.id) ?? []) {
    res.write(`data: ${removed ? 'null' : JSON.stringify(t)}\n\n`);
    if (removed) res.end();
  }
  for (const reply of waiters.get(t.id) ?? []) reply(removed ? null : t);
  waiters.delete(t.id);
  if (removed) streams.delete(t.id);
});

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, PING_MS).unref();

let catalog: Catalog | null = null;

async function readCatalog(): Promise<Catalog> {
  try {
    catalog = await game.catalog();
  } catch (err) {
    if (!catalog) throw new ApiError(502, (err as Error).message);
  }
  return catalog!;
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method ?? 'GET';
  const is = (m: string, ...path: (string | null)[]) => method === m && parts.length === path.length && path.every((p, i) => p === null || p === parts[i]);

  if (is('GET', 'formats')) return json(res, 200, FORMATS.map(formatInfo));
  if (is('GET', 'formats', null, 'plan')) {
    let format;
    let options;
    try {
      format = getFormat(parts[1]);
      options = resolveOptions({ legs: url.searchParams.has('legs') ? Number(url.searchParams.get('legs')) : undefined });
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
    const size = Number(url.searchParams.get('entrants'));
    if (!Number.isInteger(size) || size < 0 || size > 1024) throw new ApiError(400, '"entrants" must be a whole number from 0 to 1024');
    return json(res, 200, plan(format, size, options));
  }
  if (is('GET', 'game')) return json(res, 200, runner.link);
  if (is('GET', 'game', 'catalog')) return json(res, 200, await readCatalog());

  if (is('GET', 'tournaments')) return json(res, 200, store.list());
  if (is('POST', 'tournaments')) return json(res, 201, await runner.create(await readBody(req)));

  if (parts[0] !== 'tournaments' || parts.length < 2) throw new ApiError(404, 'Not found');
  const t = store.get(parts[1]);

  if (is('GET', 'tournaments', null)) {
    const wait = url.searchParams.get('wait');
    if (wait !== null && Number(wait) >= t.version) return waitFor(req, res, t);
    return json(res, 200, t);
  }
  if (is('DELETE', 'tournaments', null)) {
    runner.remove(t);
    return json(res, 200, t);
  }
  if (is('GET', 'tournaments', null, 'events')) return openStream(req, res, t);
  if (is('PATCH', 'tournaments', null, 'entrants')) return json(res, 200, await runner.patchEntrants(t, await readBody(req, true)));
  if (is('POST', 'tournaments', null, 'start')) {
    await runner.startStage(t);
    return json(res, 200, t);
  }
  if (is('POST', 'tournaments', null, 'stop')) {
    runner.stopStage(t);
    return json(res, 200, t);
  }
  if (is('POST', 'tournaments', null, 'matches', null, 'replay')) {
    const body = await readBody(req);
    runner.replay(t, parts[3], body.seed ?? undefined);
    return json(res, 200, t);
  }
  if (is('POST', 'tournaments', null, 'matches', null, 'winner')) {
    const body = await readBody(req);
    if (typeof body.winner !== 'string') throw new ApiError(400, '"winner" must be an entrant id');
    runner.setWinner(t, parts[3], body.winner);
    return json(res, 200, t);
  }
  throw new ApiError(404, 'Not found');
}

function openStream(req: http.IncomingMessage, res: http.ServerResponse, t: Tournament) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  req.socket.setTimeout(0);
  const set = streams.get(t.id) ?? new Set();
  set.add(res);
  streams.set(t.id, set);
  res.write(`data: ${JSON.stringify(t)}\n\n`);
  res.on('close', () => set.delete(res));
}

// Holds the request until the tournament changes. A deleted tournament is a 404.
function waitFor(req: http.IncomingMessage, res: http.ServerResponse, t: Tournament) {
  req.socket.setTimeout(0);
  const set = waiters.get(t.id) ?? new Set();
  const reply = (next: Tournament | null) => (next ? json(res, 200, next) : json(res, 404, { error: 'The tournament was deleted' }));
  set.add(reply);
  waiters.set(t.id, set);
  res.on('close', () => set.delete(reply));
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, list = false): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new ApiError(413, 'Request body too large');
  }
  if (!raw) return list ? [] : {};
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'The body must be JSON');
  }
  if (list ? !Array.isArray(body) : !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, list ? 'The body must be a JSON list' : 'The body must be a JSON object');
  }
  return body;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found. The Tournament API is under /api.' });
    try {
      await route(req, res, url);
    } catch (err) {
      if (err instanceof ApiError) return json(res, err.status, { error: err.message, ...(err.problems ? { problems: err.problems } : {}) });
      console.error(err);
      json(res, 500, { error: 'Server error' });
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`Tournament API on http://${HOST}:${PORT}/api`);
    console.log(`  Game API: ${game.GAME_API}`);
  });

void runner.pingGame();
setInterval(() => void runner.pingGame(), GAME_PING_MS).unref();
runner.resume();
