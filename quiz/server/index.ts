// HTTP API + live updates (server-sent events) + the built client from dist/.
// No dependencies: run with `node server/index.ts`.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as store from './store.ts';

const PORT = Number(process.env.PORT ?? 3001);
const DIST = path.join(import.meta.dirname, '..', 'dist');
const KEY_FILE = path.join(import.meta.dirname, '..', 'data', 'admin-token.txt');

// The key that /admin needs. ADMIN_KEY wins; otherwise a random one is made
// once and kept in data/admin-token.txt, so restarting the server (which
// `npm run dev` does on every file change) does not lock the host out.
function readAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  const saved = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '';
  if (saved) return saved;
  const key = randomBytes(4).toString('hex'); // short enough to type on a phone
  fs.writeFileSync(KEY_FILE, `${key}\n`);
  return key;
}
const ADMIN_KEY = readAdminKey();

interface Client {
  res: http.ServerResponse;
  teamId: string | null; // null = admin
}
const clients = new Set<Client>();

function send(client: Client) {
  let data: unknown;
  if (client.teamId === null) {
    const online = [...clients].flatMap((c) => (c.teamId ? [c.teamId] : []));
    data = store.adminView(online);
  } else {
    const team = store.findTeam(client.teamId);
    data = team ? store.teamView(team) : null; // null tells the device its team was deleted
  }
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast() {
  for (const client of clients) send(client);
}
store.onChange(broadcast);

// Keep connections open through proxies.
setInterval(() => {
  for (const { res } of clients) res.write(': ping\n\n');
}, 20_000);

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function isAdmin(key: string | null | undefined) {
  return key === ADMIN_KEY;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/events') {
    const token = url.searchParams.get('token');
    let client: Client;
    if (token) {
      if (!store.findTeam(token)) return json(res, 404, { error: 'Unknown team' });
      client = { res, teamId: token };
    } else {
      if (!isAdmin(url.searchParams.get('key'))) return json(res, 401, { error: 'Wrong admin key' });
      client = { res, teamId: null };
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(client);
    req.on('close', () => {
      clients.delete(client);
      broadcast(); // update the online list on the admin page
    });
    return broadcast();
  }

  // Read by the game: one { team, weapon, upgrades } per team.
  if (route === 'GET /api/loadouts') return json(res, 200, store.loadouts());
  if (route === 'GET /api/weapons') return json(res, 200, store.catalog.weapons);

  if (route === 'POST /api/join') {
    const body = await readBody(req);
    const team = store.join(body.name, body.weapon, body.code);
    return json(res, 200, { token: team.id });
  }

  if (route === 'POST /api/admin') {
    if (!isAdmin(req.headers['x-admin-key'] as string)) return json(res, 401, { error: 'Wrong admin key' });
    store.adminAction(await readBody(req));
    return json(res, 200, { ok: true });
  }

  const team = store.findTeam(req.headers['x-team-token'] as string);
  if (req.method === 'POST' && !team) return json(res, 401, { error: 'Unknown team. Join again.' });

  if (route === 'POST /api/answer') {
    store.answer(team!, (await readBody(req)).choice);
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/weapon') {
    store.chooseWeapon(team!, (await readBody(req)).weapon);
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/pick') {
    store.pick(team!, (await readBody(req)).upgradeId);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Not found' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(res: http.ServerResponse, url: URL) {
  let file = path.join(DIST, path.normalize(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // client-side routes: /, /admin
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('Client not built. Run `npm run build`, or use `npm run dev`.');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url);
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (err instanceof store.UserError) return json(res, 400, { error: err.message });
      console.error(err);
      json(res, 500, { error: 'Server error' });
    }
  })
  .listen(PORT, () => {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => a!.address);
    console.log(`Quiz server on port ${PORT} (${['localhost', ...addresses].join(', ')})`);
    const source = process.env.ADMIN_KEY
      ? 'from ADMIN_KEY'
      : `stored in ${path.relative(process.cwd(), KEY_FILE)} — delete that file for a new one`;
    console.log(`\n  Admin key: ${ADMIN_KEY}  (${source})\n  The host enters it on /admin.\n`);
  });
