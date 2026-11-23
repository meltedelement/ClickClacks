// The Letter Brawl's server: the bracket's (one port for everything: the pages,
// the party API, the tournament through the tournament service, and the game's
// display page passed on), plus the word guesses. The game and the tournament
// service stay off the network; the words come from two open APIs (words.ts).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createParty, lanAddresses, publicUrls } from '../../../party/server/index.ts';
import type { RouteContext } from '../../../party/server/index.ts';
import type { Player } from '../../bracket/server/store.ts';
import { httpService } from '../../bracket/server/tournament.ts';
import { httpHost } from '../../royale/server/host.ts';
import { createLetterBrawl } from './store.ts';
import { httpWords } from './words.ts';

const PORT = Number(process.env.PORT ?? 8080);

// Where players join, shown big on the host page: a Tailscale Funnel URL first
// when one forwards to this port (it works from anywhere), then the LAN addresses.
function joinAddresses(): string[] {
  return [...publicUrls(PORT), ...lanAddresses().map((ip) => `http://${ip}:${PORT}/`)];
}

const GAME = (process.env.GAME_URL ?? 'http://127.0.0.1:3006').replace(/\/+$/, '');
const TOURNAMENT_API = (process.env.TOURNAMENT_API ?? 'http://127.0.0.1:3007/api').replace(/\/+$/, '');
const ROOT = path.join(import.meta.dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const ROYALE_CLIENT = path.join(ROOT, '..', 'royale', 'client');
const BRACKET_CLIENT = path.join(ROOT, '..', 'bracket', 'client');
const PARTY = path.join(ROOT, '..', '..', 'party');
const RETRY_MS = 1_000;

const service = httpService(TOURNAMENT_API);
const host = httpHost(`${GAME}/api`); // the game's Match Host API, for the royale at the end
const brawl = createLetterBrawl({ service, host, words: httpWords(), onChange: () => party.broadcast() });

const party = createParty<Player>({
  dataDir: path.join(ROOT, 'data'),
  dist: null,
  findPlayer: (token) => brawl.findPlayer(token),
  playerView: (player) => brawl.playerView(player),
  adminView: ({ online }) => ({ ...brawl.adminView(online), join: joinAddresses() }),
});

const nothing = (fn: (ctx: RouteContext<Player>) => unknown) => async (ctx: RouteContext<Player>) => {
  await fn(ctx);
};

party.route('POST', '/join', 'public', ({ body }) => ({ token: brawl.join(body.name) }));
party.route('POST', '/weapon', 'player', nothing(({ player, body }) => brawl.takeWeapon(player!, body.weapon)));
party.route('POST', '/guess', 'player', nothing(({ player, body }) => brawl.guess(player!, body.word)));
party.route('POST', '/pick', 'player', nothing(({ player, body }) => brawl.takePick(player!, body.id)));
party.route('POST', '/leave', 'player', nothing(({ token }) => brawl.leave(token!)));
party.route('POST', '/settings-check', 'admin', () => ({ ok: true })); // the host page's way to test a key
party.route('POST', '/format', 'admin', nothing(({ body }) => brawl.setFormat(body.format)));
party.route('POST', '/start', 'admin', nothing(() => brawl.startTournament()));
party.route('POST', '/start-stage', 'admin', nothing(() => brawl.startStage()));
party.route('POST', '/stop-stage', 'admin', nothing(() => brawl.stopStage()));
party.route('POST', '/end', 'admin', nothing(() => brawl.endTournament()));
party.route('POST', '/look', 'admin', nothing(({ body }) => brawl.setLook(body.id, body)));
party.route('POST', '/remove', 'admin', nothing(({ body }) => brawl.removeById(body.id)));

// The game's display page and what it calls, and nothing else of the game: a
// display can say a fight started and how it ended, but can't queue or cancel one.
function allowedGamePath(method: string, gamePath: string): boolean {
  if (method === 'GET') return gamePath === '/' || gamePath === '/api/display' || /^\/assets\/[\w.-]+$/.test(gamePath);
  return method === 'POST' && /^\/api\/matches\/[\w-]+\/(start|result)$/.test(gamePath);
}

function proxyToGame(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const gamePath = url.pathname.slice('/game'.length);
  if (!allowedGamePath(req.method ?? 'GET', gamePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const upstream = http.request(`${GAME}${gamePath}${url.search}`, { method: req.method, headers: { ...req.headers, host: new URL(GAME).host } }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'The game is not answering' }));
    else res.end();
  });
  res.on('close', () => upstream.destroy()); // an event stream ends when the device goes
  req.socket.setTimeout(0);
  req.pipe(upstream);
}

const PAGES: Record<string, { file: string; type: string; typescript?: boolean }> = {
  '/': { file: path.join(CLIENT, 'phone.html'), type: 'text/html' },
  '/admin': { file: path.join(CLIENT, 'admin.html'), type: 'text/html' },
  '/letters.js': { file: path.join(CLIENT, 'letters.js'), type: 'text/javascript' },
  '/letters.css': { file: path.join(CLIENT, 'letters.css'), type: 'text/css' },
  // The bracket's pieces (bracket, match on now, winner card) and the royale's look.
  '/bracket.js': { file: path.join(BRACKET_CLIENT, 'bracket.js'), type: 'text/javascript' },
  '/bracket.css': { file: path.join(BRACKET_CLIENT, 'bracket.css'), type: 'text/css' },
  // The royale's look and page helpers: the two apps share them.
  '/style.css': { file: path.join(ROYALE_CLIENT, 'style.css'), type: 'text/css' },
  '/ui.js': { file: path.join(ROYALE_CLIENT, 'ui.js'), type: 'text/javascript' },
  // Party's browser client, as plain JavaScript: this app has no build step.
  '/client/index.ts': { file: path.join(PARTY, 'client', 'index.ts'), type: 'text/javascript', typescript: true },
  '/shared/protocol.ts': { file: path.join(PARTY, 'shared', 'protocol.ts'), type: 'text/javascript', typescript: true },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) return void party.handle(req, res);
  if (url.pathname === '/game') return void res.writeHead(302, { Location: `/game/${url.search}` }).end();
  if (url.pathname.startsWith('/game/')) return proxyToGame(req, res, url);
  const page = PAGES[url.pathname];
  if (!page) return void res.writeHead(404).end('Not found');
  const text = fs.readFileSync(page.file, 'utf8');
  res.writeHead(200, { 'Content-Type': page.type, 'Cache-Control': 'no-store' });
  res.end(page.typescript ? stripTypeScriptTypes(text) : text);
});

// The lobby opens straight away; drafting starts when the game's catalog has
// come through the tournament service.
async function load() {
  for (;;) {
    try {
      brawl.setFormats(await service.formats());
      brawl.setCatalog(await service.catalog());
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

server.listen(PORT, () => {
  void load();
  console.log(`Letter Brawl on port ${PORT}. Key: ${party.adminKey}`);
});
