// A buzzer game on party, to try party by hand without any app: phones join
// with a name and press a buzzer, the admin page clears it and can remove
// players. `npm run demo` in party/, then open the printed addresses.
//
// No build step: party's browser client is TypeScript, so this server strips
// its types as it serves it (Node's own module.stripTypeScriptTypes).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { PartyError, createParty, lanAddresses } from '../server/index.ts';

interface Player {
  name: string;
}

const PORT = Number(process.env.PORT ?? 3100);
const DEMO = import.meta.dirname;
const PARTY = path.join(DEMO, '..');

const players = new Map<string, Player>();
let buzzed: string | null = null;

const party = createParty<Player>({
  dataDir: path.join(os.tmpdir(), 'party-demo'), // the admin key, kept across restarts
  dist: null,
  findPlayer: (token) => players.get(token),
  playerView: (player) => ({ name: player.name, buzzed, players: players.size }),
  adminView: ({ online }) => ({
    players: [...players].map(([token, p]) => ({ token, name: p.name, online: online.includes(token) })),
    buzzed,
  }),
});

party.route('POST', '/join', 'public', ({ body }) => {
  const name = String(body.name ?? '').trim().slice(0, 20);
  if (!name) throw new PartyError('Enter a name');
  if ([...players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new PartyError('That name is taken');
  const token = randomUUID();
  players.set(token, { name });
  party.broadcast();
  return { token };
});
party.route('POST', '/buzz', 'player', ({ player }) => {
  buzzed ??= player!.name;
  party.broadcast();
});
party.route('POST', '/clear', 'admin', () => {
  buzzed = null;
  party.broadcast();
});
party.route('POST', '/remove', 'admin', ({ body }) => {
  if (!players.delete(String(body.token))) throw new PartyError('No such player');
  party.broadcast(); // the removed player's devices get null
});
party.route('POST', '/reset', 'admin', () => {
  players.clear();
  buzzed = null;
  party.broadcast();
});

// The pages, and party's client and protocol as plain JavaScript.
const PAGES: Record<string, string> = { '/': 'phone.html', '/admin': 'admin.html' };
const SCRIPTS: Record<string, string> = {
  '/client/index.ts': path.join(PARTY, 'client', 'index.ts'),
  '/shared/protocol.ts': path.join(PARTY, 'shared', 'protocol.ts'),
};

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname.startsWith('/api/')) return void party.handle(req, res);
  if (PAGES[pathname]) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return void res.end(fs.readFileSync(path.join(DEMO, PAGES[pathname]), 'utf8'));
  }
  if (SCRIPTS[pathname]) {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    return void res.end(stripTypeScriptTypes(fs.readFileSync(SCRIPTS[pathname], 'utf8')));
  }
  res.writeHead(404).end('Not found');
}

http.createServer(serve).listen(PORT, () => {
  console.log(`Party demo (buzzer)`);
  console.log(`  phones: http://localhost:${PORT}/`);
  for (const ip of lanAddresses()) console.log(`          http://${ip}:${PORT}/`);
  console.log(`  admin:  http://localhost:${PORT}/admin   key: ${party.adminKey}`);
});
