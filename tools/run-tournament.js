// Starts a Ball Bracket night (or a Letter Brawl, with --app=letter-brawl):
// builds the game, runs it and the tournament service privately on this machine,
// and runs the app on one port for everyone on the network.
//
//   npm run tournament              port 8080
//   npm run tournament -- 9000      another port (or PORT=9000)
//   npm run brawl                   the Letter Brawl (node tools/run-tournament.js --app=letter-brawl)
//
// Bracket -> Tournament API -> tournament service -> Match Host API -> the game.
// The game and the service listen on 127.0.0.1 only; the app passes on just what
// a browser needs to show a fight. Any server stopping stops the others, and
// Ctrl-C stops all three.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const GAME = path.join(ROOT, 'games', 'weapon-balls');
const APPS = { bracket: 'bracket app', 'letter-brawl': 'Letter Brawl app' };
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APP_ID = flags.find((f) => f.startsWith('--app='))?.slice('--app='.length) ?? 'bracket';
const APP = path.join(ROOT, 'apps', APP_ID);
const APP_NAME = APPS[APP_ID];
const TOURNAMENT = path.join(ROOT, 'tournament');
const PORT = Number(args[0] ?? process.env.PORT ?? 8080);
const GAME_PORT = Number(process.env.GAME_PORT ?? 3006);
const TOURNAMENT_PORT = Number(process.env.TOURNAMENT_PORT ?? 3007);
const GAME_URL = `http://127.0.0.1:${GAME_PORT}`;
const TOURNAMENT_API = `http://127.0.0.1:${TOURNAMENT_PORT}/api`;
const KEY_FILE = path.join(APP, 'data', 'admin-token.txt');

const children = [];
let stopping = false;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

function run(name, args, options) {
  const log = [];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { ...options, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      log.push(chunk);
      if (log.length > 200) log.shift();
      if (stream === child.stderr) process.stderr.write(chunk);
    });
  }
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`\nThe ${name} stopped (${signal ?? `exit ${code}`}).\n${log.join('')}`);
    shutdown(code || 1);
  });
  children.push(child);
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

async function ready(url) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!APP_NAME) fail(`No app "${APP_ID}". Try one of: ${Object.keys(APPS).join(', ')}.`);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`"${args[0]}" isn't a port number.`);
if (!fs.existsSync(path.join(GAME, 'node_modules', 'vite'))) fail('Run `npm run install:all` in the repo root first.');
for (const port of [PORT, GAME_PORT, TOURNAMENT_PORT]) {
  if (!(await portFree(port))) fail(`Port ${port} is already in use. Stop whatever is on it, or pick another with \`npm run tournament -- <port>\`.`);
}

console.log('Building the game...');
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: GAME, encoding: 'utf8', shell: process.platform === 'win32' });
if (build.status !== 0) fail(`${build.stdout}${build.stderr}\nThe game build failed.`);

// The app keeps its players in memory, so a tournament left from an
// earlier night has nobody to play it: start the service with none. Each copy
// (by its port) has its own folder, so a second one running beside it (a test
// on other ports) can't pick up, play or clear the first one's tournaments.
const TOURNAMENT_DATA = path.join(APP, 'data', `tournament-${PORT}`);
fs.rmSync(TOURNAMENT_DATA, { recursive: true, force: true });

// One screen: the matches play one at a time, and every device shows the same one.
run('game', ['server/index.js'], { cwd: GAME, env: { PORT: String(GAME_PORT), HOST: '127.0.0.1', SCREENS: '1' } });
if (!(await ready(`${GAME_URL}/api/status`))) {
  console.error('The game did not come up.');
  shutdown(1);
} else {
  run('tournament service', ['server/index.ts'], { cwd: TOURNAMENT, env: { PORT: String(TOURNAMENT_PORT), HOST: '127.0.0.1', HOST_API: `${GAME_URL}/api`, DATA_DIR: TOURNAMENT_DATA } });
  run(APP_NAME, ['server/index.ts'], { cwd: APP, env: { PORT: String(PORT), GAME_URL, TOURNAMENT_API } });
  if (!(await ready(`${TOURNAMENT_API}/formats`)) || !(await ready(`http://127.0.0.1:${PORT}/api/lan`))) {
    console.error(`The tournament service or the ${APP_NAME} did not come up.`);
    shutdown(1);
  } else {
    const { addresses, public: funnels = [] } = await (await fetch(`http://127.0.0.1:${PORT}/api/lan`)).json();
    const join = [...funnels, ...addresses.map((ip) => `http://${ip}:${PORT}/`)];
    const key = process.env.ADMIN_KEY || fs.readFileSync(KEY_FILE, 'utf8').trim();
    console.log(`
  Host page:   http://localhost:${PORT}/admin?key=${key}

  Players join at:
${join.length > 0 ? join.map((url) => `    ${url}`).join('\n') : `    (no network address found; http://localhost:${PORT}/ on this machine)`}${funnels.length > 0 ? '' : `\n    (for players outside this network: tailscale funnel ${PORT})`}

Ctrl-C stops everything.`);
  }
}
