// Party's server against a tiny made-up game: players join with a name and
// press a buzzer; the admin clears it. `npm test` in party/. No app needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { ADMIN_HEADER, PLAYER_HEADER } from '../shared/protocol.ts';
import { PartyError, createParty } from './index.ts';

interface Player {
  name: string;
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-test-'));
const players = new Map<string, Player>();
let buzzed: string | null = null;

const party = createParty<Player>({
  dataDir,
  findPlayer: (token) => players.get(token),
  playerView: (player) => ({ name: player.name, buzzed }),
  adminView: ({ online }) => ({ players: [...players.values()].map((p) => p.name), online: online.length, buzzed }),
});
party.route('POST', '/join', 'public', ({ body }) => {
  const name = String(body.name ?? '').trim();
  if (!name) throw new PartyError('Enter a name');
  const token = `t${players.size + 1}`;
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

const server = party.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(() => {
  party.close();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function post(route: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

// Opens an event stream; `next()` resolves with the next view it sends.
async function events(query: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events?${query}`, { signal: controller.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  async function next(): Promise<any> {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = message.split('\n').find((line) => line.startsWith('data: '));
        if (data && !message.includes('event: ping')) return JSON.parse(data.slice(6));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += value;
    }
  }
  return { status: res.status, next, close: () => controller.abort() };
}

test('the admin key is kept in the data folder', () => {
  assert.match(party.adminKey, /^[0-9a-f]{8}$/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'admin-token.txt'), 'utf8').trim(), party.adminKey);
  const again = createParty({ dataDir, findPlayer: () => undefined, playerView: () => null, adminView: () => null });
  assert.equal(again.adminKey, party.adminKey);
  again.close();
});

test('routes check who is asking', async () => {
  assert.deepEqual(await post('/join', { name: '' }), { status: 400, body: { error: 'Enter a name' } });
  assert.equal((await post('/buzz', {})).status, 401);
  assert.equal((await post('/buzz', {}, { [PLAYER_HEADER]: 'nobody' })).status, 401);
  assert.equal((await post('/clear', {}, { [ADMIN_HEADER]: 'wrong' })).status, 401);
  assert.deepEqual(await post('/clear', {}, { [ADMIN_HEADER]: party.adminKey }), { status: 200, body: { ok: true } });
  assert.equal((await post('/nope', {})).status, 404);
  const bad = await fetch(`${base}/api/join`, { method: 'POST', body: '{not json' });
  assert.equal(bad.status, 400);
});

test('the admin event stream needs the key', async () => {
  const res = await fetch(`${base}/api/events?key=wrong`);
  assert.equal(res.status, 401);
  await res.body?.cancel();
});

test('an unknown player gets null and the stream ends', async () => {
  const stream = await events('token=gone');
  assert.equal(await stream.next(), null);
  assert.equal(await stream.next(), undefined);
});

test('views go out live, and the admin sees who is online', async () => {
  const admin = await events(`key=${party.adminKey}`);
  assert.equal((await admin.next()).online, 0);

  const { body } = await post('/join', { name: 'Ada' });
  assert.deepEqual((await admin.next()).players.includes('Ada'), true);

  const phone = await events(`token=${body.token}`);
  assert.deepEqual(await phone.next(), { name: 'Ada', buzzed: null });
  assert.equal((await admin.next()).online, 1);

  await post('/buzz', {}, { [PLAYER_HEADER]: body.token });
  assert.deepEqual(await phone.next(), { name: 'Ada', buzzed: 'Ada' });
  assert.equal((await admin.next()).buzzed, 'Ada');
  assert.deepEqual(party.online(), [body.token]);

  phone.close();
  assert.equal((await admin.next()).online, 0);
  admin.close();
});

test('LAN addresses are served', async () => {
  const res = await fetch(`${base}/api/lan`);
  assert.ok(Array.isArray((await res.json()).addresses));
});
