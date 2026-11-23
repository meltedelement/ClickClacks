// Starts a Ball Royale night: builds the game, runs it privately on this machine,
// and runs the royale app on one port for everyone on the network.
//
//   npm run royale              port 8080
//   npm run royale -- 9000      another port (or PORT=9000)
//
// Royale -> Match Host API -> the game. The game listens on 127.0.0.1 only; the
// app passes on just what a browser needs to show a fight. Any server stopping
// stops the other, and Ctrl-C stops both.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const GAME = path.join(ROOT, 'games', 'weapon-balls');
const APP = path.join(ROOT, 'apps', 'royale');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const GAME_PORT = Number(process.env.GAME_PORT ?? 3005);
const GAME_URL = `http://127.0.0.1:${GAME_PORT}`;
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

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`"${process.argv[2]}" isn't a port number.`);
if (!fs.existsSync(path.join(GAME, 'node_modules', 'vite'))) fail('Run `npm run install:all` in the repo root first.');
for (const port of [PORT, GAME_PORT]) {
  if (!(await portFree(port))) fail(`Port ${port} is already in use. Stop whatever is on it, or pick another with \`npm run royale -- <port>\`.`);
}

console.log('Building the game...');
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: GAME, encoding: 'utf8', shell: process.platform === 'win32' });
if (build.status !== 0) fail(`${build.stdout}${build.stderr}\nThe game build failed.`);

// One screen: a royale is one fight, however many devices are showing it.
run('game', ['server/index.js'], { cwd: GAME, env: { PORT: String(GAME_PORT), HOST: '127.0.0.1', SCREENS: '1' } });
if (!(await ready(`${GAME_URL}/api/status`))) {
  console.error('The game did not come up.');
  shutdown(1);
} else {
  run('royale app', ['server/index.ts'], { cwd: APP, env: { PORT: String(PORT), GAME_URL } });
  if (!(await ready(`http://127.0.0.1:${PORT}/api/lan`))) {
    console.error('The royale app did not come up.');
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
