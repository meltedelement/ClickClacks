// The royale's server: one port for everything, so one address is all anyone
// needs. It serves the pages, the party API, and the few parts of the game a
// browser needs to show a fight. The game itself stays off the network: only
// this server talks to it, and nobody else can queue or cancel matches on it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createParty, lanAddresses, publicUrls } from '../../../party/server/index.ts';
import type { RouteContext } from '../../../party/server/index.ts';
import { httpHost } from './host.ts';
import { createRoyale } from './store.ts';
import type { Player } from './store.ts';

const PORT = Number(process.env.PORT ?? 8080);

// Where players join, shown big on the host page: a Tailscale Funnel URL first
// when one forwards to this port (it works from anywhere), then the LAN addresses.
function joinAddresses(): string[] {
  return [...publicUrls(PORT), ...lanAddresses().map((ip) => `http://${ip}:${PORT}/`)];
}

const GAME = (process.env.GAME_URL ?? 'http://127.0.0.1:3005').replace(/\/+$/, '');
const ROOT = path.join(import.meta.dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const PARTY = path.join(ROOT, '..', '..', 'party');
const CATALOG_RETRY_MS = 1_000;

const host = httpHost(`${GAME}/api`);
const royale = createRoyale({ host, onChange: () => party.broadcast() });

const party = createParty<Player>({
  dataDir: path.join(ROOT, 'data'),
  dist: null,
  findPlayer: (token) => royale.findPlayer(token),
  playerView: (player) => royale.playerView(player),
  adminView: ({ online }) => ({ ...royale.adminView(online), join: joinAddresses() }),
});

const nothing = (fn: (ctx: RouteContext<Player>) => void) => (ctx: RouteContext<Player>) => {
  fn(ctx);
};

party.route('POST', '/join', 'public', ({ body }) => ({ token: royale.join(body.name) }));
party.route('POST', '/weapon', 'player', nothing(({ player, body }) => royale.takeWeapon(player!, body.weapon)));
party.route('POST', '/pick', 'player', nothing(({ player, body }) => royale.takePick(player!, body.id)));
party.route('POST', '/leave', 'player', nothing(({ token }) => royale.leave(token!)));
party.route('POST', '/settings-check', 'admin', () => ({ ok: true })); // the host page's way to test a key
party.route('POST', '/start', 'admin', nothing(() => royale.start()));
party.route('POST', '/abort', 'admin', nothing(() => royale.abort()));
party.route('POST', '/next', 'admin', nothing(() => royale.nextRound()));
party.route('POST', '/restart-builds', 'admin', nothing(() => royale.restartBuilds()));
party.route('POST', '/settings', 'admin', nothing(({ body }) => {
  if (body.minBalls !== undefined) royale.setMinBalls(body.minBalls);
  if (body.botSize !== undefined) royale.setBotSize(body.botSize);
  if (body.mode !== undefined) royale.setMode(body.mode);
}));
party.route('POST', '/look', 'admin', nothing(({ body }) => royale.setLook(body.id, body)));
party.route('POST', '/remove', 'admin', nothing(({ body }) => royale.removeById(body.id)));

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
  '/style.css': { file: path.join(CLIENT, 'style.css'), type: 'text/css' },
  '/ui.js': { file: path.join(CLIENT, 'ui.js'), type: 'text/javascript' },
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

// The lobby opens straight away; drafting starts when the game has answered.
async function loadCatalog() {
  for (;;) {
    try {
      royale.setCatalog(await host.catalog());
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, CATALOG_RETRY_MS));
    }
  }
}

server.listen(PORT, () => {
  void loadCatalog();
  console.log(`Royale on port ${PORT}. Key: ${party.adminKey}`);
});
