// Party: the server side of a Jackbox-style game, where players join on their
// phones, an admin runs it from a page, and a big screen shows it to the room.
// Party knows nothing about the game. It owns the connections: the admin key,
// players' tokens, live views pushed over server-sent events (with heartbeats),
// who is online, JSON routes, and serving the built client. The app owns the
// state, the rules, and what each person sees.
//
//   const party = createParty({
//     dataDir,                                   // keeps the admin key in admin-token.txt
//     dist,                                      // the built client, or null
//     findPlayer: (token) => store.findPlayer(token),
//     playerView: (player) => store.playerView(player),
//     adminView: ({ online }) => store.adminView(online),
//   });
//   party.route('POST', '/join', 'public', ({ body }) => ({ token: store.join(body.name) }));
//   party.route('POST', '/answer', 'player', ({ player, body }) => store.answer(player, body.choice));
//   party.route('POST', '/admin', 'admin', ({ body }) => store.adminAction(body));
//   store.onChange(party.broadcast);             // every view goes out again
//   party.listen(3001);
//
// The protocol is in ../shared/protocol.ts; ../client/index.ts speaks it.
// No dependencies: Node's own http, run as TypeScript.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ADMIN_HEADER, EVENTS_PATH, LAN_PATH, PING_MS, PLAYER_HEADER } from '../shared/protocol.ts';
import type { LanBody } from '../shared/protocol.ts';

const MAX_BODY = 256 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * An error to show the person who made the request, with its HTTP status
 * (400 unless given). Any other error is a 500, and its message stays in the
 * server log.
 */
export class PartyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PartyError';
    this.status = status;
  }
}

export type Access = 'public' | 'player' | 'admin';

export interface RouteContext<P> {
  /** The JSON body (an object, a list, or {} when empty). */
  body: any;
  /** The player who sent it: set for 'player' routes, and for 'public' ones when a known token came with it. */
  player: P | undefined;
  /** The player's token, if one came with the request. */
  token: string | undefined;
  url: URL;
  req: http.IncomingMessage;
}

/** What the route answers with, as JSON. Undefined answers { ok: true }. */
export type Handler<P> = (ctx: RouteContext<P>) => unknown | Promise<unknown>;

export interface PartyOptions<P> {
  /** Where the admin key is kept (admin-token.txt), so restarts keep it. */
  dataDir: string;
  /** The built client, served for every path outside /api (index.html for client-side routes). Null: serve nothing. */
  dist?: string | null;
  /** The admin key. Default: the ADMIN_KEY environment variable, else the kept one, else a new random one. */
  adminKey?: string;
  /** The player with this token, or undefined. Tokens are secrets: never put one in a view another device sees. */
  findPlayer(token: string): P | undefined;
  /** What this player's devices see. Sent on connect and on every broadcast. */
  playerView(player: P, token: string): unknown;
  /** What the admin pages see. `online` holds the tokens of players with a connection open. */
  adminView(info: { online: string[] }): unknown;
}

export interface Party<P> {
  /** The key the admin pages need. */
  readonly adminKey: string;
  /** Where the admin key is kept, or null when it came from ADMIN_KEY or the options. */
  readonly adminKeyFile: string | null;
  /** Adds a JSON route under /api. `path` is what follows /api, e.g. "/join". */
  route(method: string, path: string, access: Access, handler: Handler<P>): void;
  /** Sends every connection its view again. Call it after every change to the state. */
  broadcast(): void;
  /** Tokens of the players with a connection open. */
  online(): string[];
  /** Handles a request: /api routes, the event streams, then the built client. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
  /** Starts an HTTP server on the port. */
  listen(port: number, onListening?: () => void): http.Server;
  /** Stops the heartbeat and closes every event stream (for tests, and a clean shutdown). */
  close(): void;
}

interface Connection {
  res: http.ServerResponse;
  token: string | null; // null: the admin
}

export function createParty<P>(options: PartyOptions<P>): Party<P> {
  const { key: adminKey, file: adminKeyFile } = readAdminKey(options);
  const routes = new Map<string, { access: Access; handler: Handler<P> }>();
  const connections = new Set<Connection>();

  const heartbeat = setInterval(() => {
    for (const { res } of connections) res.write('event: ping\ndata: {}\n\n');
  }, PING_MS);
  heartbeat.unref();

  function send(connection: Connection) {
    let view: unknown;
    if (connection.token === null) view = options.adminView({ online: online() });
    else {
      const player = options.findPlayer(connection.token);
      view = player === undefined ? null : options.playerView(player, connection.token); // null tells the device it was removed
    }
    connection.res.write(`data: ${JSON.stringify(view)}\n\n`);
  }

  function broadcast() {
    for (const connection of connections) send(connection);
  }

  // Only the admin view shows who is online.
  function sendAdmins() {
    for (const connection of connections) if (connection.token === null) send(connection);
  }

  function online(): string[] {
    return [...new Set([...connections].flatMap((c) => (c.token === null ? [] : [c.token])))];
  }

  function openEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const token = url.searchParams.get('token');
    if (!token && url.searchParams.get('key') !== adminKey) return json(res, 401, { error: 'Wrong admin key' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    req.socket.setTimeout(0);
    // A player removed while its device was offline: send null so the device
    // forgets its token, instead of an error that it would keep retrying.
    if (token && options.findPlayer(token) === undefined) {
      res.end('data: null\n\n');
      return;
    }
    const connection: Connection = { res, token };
    connections.add(connection);
    res.on('close', () => {
      connections.delete(connection);
      sendAdmins();
    });
    if (token) send(connection);
    sendAdmins();
  }

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const method = req.method ?? 'GET';
    if (method === 'GET' && url.pathname === EVENTS_PATH) return openEvents(req, res, url);
    if (method === 'GET' && url.pathname === LAN_PATH) return json(res, 200, { addresses: lanAddresses() } satisfies LanBody);

    const route = routes.get(`${method} ${url.pathname}`);
    if (!route) return json(res, 404, { error: 'Not found' });
    const token = header(req, PLAYER_HEADER);
    const player = token ? options.findPlayer(token) : undefined;
    if (route.access === 'admin' && header(req, ADMIN_HEADER) !== adminKey) return json(res, 401, { error: 'Wrong admin key' });
    if (route.access === 'player' && player === undefined) return json(res, 401, { error: 'Unknown player. Join again.' });
    const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
    const answer = await route.handler({ body, player, token, url, req });
    json(res, 200, answer === undefined ? { ok: true } : answer);
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url, options.dist ?? null);
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (err instanceof PartyError) return json(res, err.status, { error: err.message });
      console.error(err);
      json(res, 500, { error: 'Server error' });
    }
  }

  return {
    adminKey,
    adminKeyFile,
    route(method, routePath, access, handler) {
      routes.set(`${method.toUpperCase()} /api${routePath.startsWith('/') ? routePath : `/${routePath}`}`, { access, handler });
    },
    broadcast,
    online,
    handle,
    listen(port, onListening) {
      return http.createServer((req, res) => void handle(req, res)).listen(port, onListening);
    },
    close() {
      clearInterval(heartbeat);
      for (const { res } of connections) res.end();
      connections.clear();
    },
  };
}

// ADMIN_KEY wins; otherwise a random one is made once and kept in the data
// folder, so restarting the server (which `node --watch` does on every file
// change) does not lock the admin out.
function readAdminKey(options: PartyOptions<unknown>): { key: string; file: string | null } {
  if (options.adminKey) return { key: options.adminKey, file: null };
  if (process.env.ADMIN_KEY) return { key: process.env.ADMIN_KEY, file: null };
  const file = path.join(options.dataDir, 'admin-token.txt');
  const saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  if (saved) return { key: saved, file };
  const key = randomBytes(4).toString('hex'); // short enough to type on a phone
  fs.mkdirSync(options.dataDir, { recursive: true });
  fs.writeFileSync(file, `${key}\n`);
  return { key, file };
}

/**
 * This machine's IPv4 addresses on the local network: where phones in the room
 * reach it. Addresses in the private ranges come first, so a VPN address
 * (Tailscale's 100.x, say) is not the one shown to the room.
 */
export function lanAddresses(): string[] {
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
    .sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new PartyError('Request body too large', 413);
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PartyError('The body must be JSON');
  }
}

function serveStatic(res: http.ServerResponse, url: URL, dist: string | null): void {
  if (!dist) return json(res, 404, { error: 'Not found' });
  let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html'); // client-side routes
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Client not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
