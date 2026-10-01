// HTTP API + live updates (server-sent events) + the built client from dist/.
// No dependencies: run with `node server/index.ts`.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as store from './store.ts';
import * as catalog from './catalog.ts';
import * as tournament from './tournament.ts';
import { currentStage } from '../shared/tournament.ts';
import type { FormatId } from '../shared/types.ts';

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

// This machine's IPv4 addresses on the local network. Addresses in the private
// ranges come first, so a VPN address (Tailscale's 100.x, say) is not the one
// the presenter shows to the room.
function lanAddresses(): string[] {
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
    .sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

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
// The tournament holds each team's name, colour and loadout: keep them in step.
store.onChange(() => void syncEntrants().catch(() => {}));

// Only the admin view shows who is online.
function sendAdmins() {
  for (const client of clients) if (client.teamId === null) send(client);
}

// Keeps connections open through proxies, and lets clients see that the
// connection is alive (src/api.ts reconnects after 35 s of silence).
setInterval(() => {
  for (const { res } of clients) res.write('event: ping\ndata: {}\n\n');
}, 15_000);

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
    if (!token && !isAdmin(url.searchParams.get('key'))) return json(res, 401, { error: 'Wrong admin key' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    // A team deleted while its device was offline: send null so the device
    // leaves, instead of an error that it would keep retrying.
    if (token && !store.findTeam(token)) return res.end('data: null\n\n');
    const client: Client = { res, teamId: token };
    clients.add(client);
    req.on('close', () => {
      clients.delete(client);
      sendAdmins();
    });
    if (client.teamId) send(client);
    return sendAdmins();
  }

  // Read by the game: one { team, color, weapon, upgrades, transformations } per team.
  if (route === 'GET /api/loadouts') return json(res, 200, store.loadouts());
  if (route === 'GET /api/weapons') return json(res, 200, store.getCatalog().weapons);
  // The join form asks for this every few seconds, so it can grey out the colours other teams took.
  if (route === 'GET /api/colors') return json(res, 200, { taken: store.takenColors() });
  // The presenter shows the first one as the join address when it is opened on localhost.
  if (route === 'GET /api/lan') return json(res, 200, { addresses: lanAddresses() });

  if (route === 'POST /api/join') {
    const body = await readBody(req);
    const team = store.join(body.name, body.weapon, body.color, body.code);
    return json(res, 200, { token: team.id });
  }

  if (route === 'POST /api/admin') {
    if (!isAdmin(req.headers['x-admin-key'] as string)) return json(res, 401, { error: 'Wrong admin key' });
    await adminAction(await readBody(req));
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
  if (route === 'POST /api/color') {
    store.chooseColor(team!, (await readBody(req)).color);
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/pick') {
    const body = await readBody(req);
    store.pick(team!, body.upgradeId, body.picksUsed);
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/transform') {
    const body = await readBody(req);
    store.pickTransformation(team!, String(body.transformationId), body.count);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Not found' });
}

// Battle actions go to the tournament service, so they are handled here rather
// than in store.adminAction. Everything else goes to the store.
async function adminAction(body: any) {
  try {
    switch (body?.type) {
      case 'battleCreate':
        return await createBattle(body.format, body.seed === undefined || body.seed === '' || body.seed === null ? undefined : Number(body.seed));
      case 'battleStartRound':
        return await startStage();
      case 'battleStopRound':
        return await tournament.stop(battleId());
      case 'battleReplay':
        return await tournament.replay(battleId(), String(body.matchId));
      case 'battleSetWinner':
        return await tournament.setWinner(battleId(), String(body.matchId), String(body.winner));
      case 'battleReset':
        return await resetBattle();
      case 'refreshCatalog':
        return await refreshCatalog();
    }
    // A quiz reset also drops the battle: take its matches off the game first.
    if (body?.type === 'reset') await resetBattle();
    store.adminAction(body);
    // Moving the quiz into the battle draws the bracket, so the presenter's Next
    // button is all the host needs: the next press starts the first stage. A
    // loadout the game would refuse comes back as a 400 with the reason, which
    // both the admin and the presenter pages show.
    if (body?.type === 'setPhase' && body.phase === 'battle' && !store.state.tournamentId && store.state.teams.length >= 2) {
      await createBattle();
    }
  } catch (err) {
    // The tournament service's refusals (a bad loadout, a stage already started) go to the host as they are.
    if (err instanceof tournament.TournamentApiError) throw new store.UserError(err.message);
    throw err;
  }
}

function battleId(): string {
  if (!store.state.tournamentId) throw new store.UserError('Draw the bracket first.');
  return store.state.tournamentId;
}

// The teams as entrants: their public entrant ids, never the device tokens.
function entrants() {
  return store.state.teams.map((team) => ({ ...team, id: team.entrantId }));
}

function syncEntrants() {
  return tournament.sync(entrants());
}

async function createBattle(format: FormatId = 'double-elimination', seed?: number) {
  if (store.state.tournamentId) throw new store.UserError('There is already a bracket. Reset the battle first.');
  if (store.state.teams.length < 2) throw new store.UserError('A battle needs at least two teams.');
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32)) {
    throw new store.UserError('The seed must be a whole number from 0 to 4294967295.');
  }
  const t = await tournament.create(format, entrants().map(tournament.toEntrant), seed);
  store.setTournament(t.id);
}

// Sends the teams' loadouts as they are now, then starts the stage.
async function startStage() {
  const t = store.battle();
  const stage = t && currentStage(t);
  if (!t || !stage) throw new store.UserError('Draw the bracket first.');
  const ids = new Set(stage.groups.flatMap((g) => g.entrants));
  if (store.state.teams.filter((team) => ids.has(team.entrantId)).length < ids.size) {
    throw new store.UserError('A team in this stage was deleted. Reset the battle.');
  }
  await syncEntrants();
  await tournament.start(t.id);
}

async function resetBattle() {
  const id = store.state.tournamentId;
  if (!id) return;
  try {
    await tournament.remove(id);
  } catch (err) {
    // The service is down: forget the battle here anyway, so the host is not stuck.
    if (!(err instanceof tournament.TournamentApiError && err.status === 0)) throw err;
  }
  store.setTournament(null);
}

// The catalog comes from the game (through the tournament service), so the
// quiz always offers upgrades by their real ids and stack limits.
async function refreshCatalog() {
  const live = await catalog.refresh(`${tournament.TOURNAMENT_API}/game`);
  store.onCatalogChanged();
  const current = store.getCatalog();
  console.log(
    live
      ? `Catalog: ${current.upgrades.length} upgrades and ${current.weapons.length} weapons from the game.`
      : `Catalog: offline copy (${current.upgrades.length} upgrades). Start the game and tournament servers to sync.`,
  );
}

// Keeps the "displays connected" line honest, and reads the catalog again once
// the game is up.
async function pingTournament() {
  await tournament.ping();
  if (tournament.link.game?.reachable && store.getCatalog().source !== 'game') await refreshCatalog();
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
    console.log(`Quiz server on port ${PORT} (${['localhost', ...lanAddresses()].join(', ')})`);
    const source = process.env.ADMIN_KEY
      ? 'from ADMIN_KEY'
      : `stored in ${path.relative(process.cwd(), KEY_FILE)} — delete that file for a new one`;
    console.log(`\n  Admin key: ${ADMIN_KEY}  (${source})\n  The host enters it on /admin.`);
    console.log(`  Tournament API: ${tournament.TOURNAMENT_API}`);
  });

// Read the game's catalog, then keep an eye on the tournament service and the
// game from here on. A battle that was playing carries on by itself: the
// tournament service runs it.
void pingTournament();
setInterval(() => void pingTournament(), 2_000).unref();
// The tournament was deleted on the service (or the service lost it).
tournament.onDeleted((id) => {
  if (store.state.tournamentId === id) store.setTournament(null);
});
