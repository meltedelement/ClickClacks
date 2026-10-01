// Runs the game, the tournament service and the quiz together, for a test run
// or an event.
//
//   npm run dev:all     hot reload
//                       game (and match API) on 5173, tournament API on 3003,
//                       quiz client on 5174, quiz API on 3001
//   npm run start:all   builds the game and the quiz, then serves
//                       game (and match API) on 3002, tournament API on 3003,
//                       quiz on 3001
//
// Quiz -> tournament API -> game API: each service is pointed at the next for
// you, which is the part that is easy to get wrong when they are started by
// hand. Any server stopping stops the others, and Ctrl-C stops everything.
//
// The terminal shows only what the host needs: the admin page, the big screen,
// the admin key and the address teams join at. The servers' own output is
// hidden, except errors. It is printed in full if a server fails to start or
// stops. `-- --verbose` shows all of it as it comes.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const QUIZ = path.join(ROOT, 'quiz');
const TOURNAMENT = path.join(ROOT, 'tournament');
const built = process.argv.includes('--built');
const verbose = process.argv.includes('--verbose');
const KEY_FILE = path.join(QUIZ, 'data', 'admin-token.txt');
const LOG_LINES = 300; // kept per server, to print if it goes wrong

const GAME_PORT = built ? 3002 : 5173;
const QUIZ_PORT = 3001;
const QUIZ_CLIENT_PORT = 5174;
const TOURNAMENT_PORT = 3003;
// 127.0.0.1 rather than localhost: the other servers have to reach these, and
// `localhost` can resolve to ::1 only, which a server may not be on.
const GAME_API = `http://127.0.0.1:${GAME_PORT}/api`;
const TOURNAMENT_API = `http://127.0.0.1:${TOURNAMENT_PORT}/api`;

const children = [];
let shuttingDown = false;

// Lines Node prints about itself on stderr, not errors from the servers.
const NOISE = /ExperimentalWarning|node --trace-warnings/;

function run(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops anything it starts.
    detached: process.platform !== 'win32',
  });
  child.log = [];
  for (const stream of [child.stdout, child.stderr]) {
    const isError = stream === child.stderr;
    stream.setEncoding('utf8');
    let buffered = '';
    stream.on('data', (chunk) => {
      const lines = (buffered + chunk).split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        child.log.push(line);
        if (child.log.length > LOG_LINES) child.log.shift();
        if (verbose || (isError && !NOISE.test(line))) console.log(`[${name}] ${line}`);
      }
    });
  }
  child.name = name;
  child.on('error', (err) => {
    console.error(`[${name}] ${err.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    printLog(child);
    console.log(`[${name}] stopped (${signal ?? `exit ${code}`})`);
    shutdown(code === 0 ? 1 : code ?? 1);
  });
  children.push(child);
  return child;
}

// What a server printed, for when it failed. Not again with --verbose, which showed it already.
function printLog(child) {
  if (verbose || child.log.length === 0) return;
  console.log(`\n---- ${child.name} output ----`);
  for (const line of child.log) console.log(`[${child.name}] ${line}`);
  console.log('----');
}

function stop(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, signal); // the whole group
  } catch {
    // Already gone.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stop(child, 'SIGTERM');
  setTimeout(() => {
    for (const child of children) stop(child, 'SIGKILL');
    process.exit(code);
  }, 800);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function need(file, hint) {
  if (fs.existsSync(file)) return;
  console.error(`Missing ${path.relative(ROOT, file)}. ${hint}`);
  process.exit(1);
}

function build(where, label) {
  console.log(`Building the ${label}...`);
  const result = spawnSync(npmCommand(), ['run', 'build'], {
    cwd: where,
    stdio: verbose ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    if (!verbose) process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    console.error(`The ${label} build failed.`);
    process.exit(result.status ?? 1);
  }
}

// `npm` is a .cmd shim on Windows, which spawn cannot run without a shell.
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function ready(url, seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Not up yet.
    }
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// A server left over from an earlier run would answer the readiness checks
// below, and Vite moves to the next free port on its own, so the quiz would
// talk to the wrong game. Check first instead.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

const gameVite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const quizVite = path.join(QUIZ, 'node_modules', 'vite', 'bin', 'vite.js');

need(path.join(QUIZ, 'server', 'index.ts'), 'This script belongs in the Weapon Balls repo.');
need(path.join(TOURNAMENT, 'server', 'index.ts'), 'This script belongs in the Weapon Balls repo.');

if (!built) {
  need(gameVite, 'Run `npm install` in the repo root first.');
  need(quizVite, 'Run `npm install` in quiz/ first.');
}

const ports = built ? [GAME_PORT, TOURNAMENT_PORT, QUIZ_PORT] : [GAME_PORT, TOURNAMENT_PORT, QUIZ_PORT, QUIZ_CLIENT_PORT];
const busy = [];
for (const port of ports) if (!(await portFree(port))) busy.push(port);
if (busy.length > 0) {
  console.error(`Port ${busy.join(', ')} ${busy.length > 1 ? 'are' : 'is'} already in use. Stop the other server first.`);
  process.exit(1);
}

console.log(built ? 'Starting the built game, tournament server and quiz...' : 'Starting the game, tournament server and quiz in dev mode...');

if (built) {
  build(ROOT, 'game');
  build(QUIZ, 'quiz');
  need(path.join(ROOT, 'dist', 'index.html'), 'The game build produced no dist/.');
  need(path.join(QUIZ, 'dist', 'index.html'), 'The quiz build produced no dist/.');
}

const quizApiArgs = built ? ['server/index.ts'] : ['--watch', 'server/index.ts'];
const quizEnv = { PORT: String(QUIZ_PORT), TOURNAMENT_API };
const tournamentArgs = built ? ['server/index.ts'] : ['--watch', 'server/index.ts'];
const tournamentEnv = { PORT: String(TOURNAMENT_PORT), GAME_API };

run('tournament', process.execPath, tournamentArgs, { cwd: TOURNAMENT, env: tournamentEnv });
if (built) {
  run('game', process.execPath, ['server/index.js'], { env: { PORT: String(GAME_PORT) } });
  run('quiz', process.execPath, quizApiArgs, { cwd: QUIZ, env: quizEnv });
} else {
  // --host, like the quiz dev server: without it Vite listens on ::1 only, so
  // the quiz server (and a phone on the LAN) cannot reach the display page.
  run('game', process.execPath, [gameVite, '--host'], { env: { PORT: String(GAME_PORT) } });
  run('quiz-api', process.execPath, quizApiArgs, { cwd: QUIZ, env: quizEnv });
  run('quiz-web', process.execPath, [quizVite], { cwd: QUIZ, env: { PORT: String(QUIZ_PORT) } });
}

const gameUp = await ready(`http://127.0.0.1:${GAME_PORT}/api/status`, 90);
const tournamentUp = await ready(`${TOURNAMENT_API}/game`, 90);
const quizUp = await ready(`http://127.0.0.1:${QUIZ_PORT}/api/weapons`, 90);

if (!gameUp || !tournamentUp || !quizUp) {
  for (const child of children) printLog(child);
  console.error(`\n${!gameUp ? 'The game' : !tournamentUp ? 'The tournament server' : 'The quiz'} did not come up. See the output above.`);
  shutdown(1);
} else {
  const port = built ? QUIZ_PORT : QUIZ_CLIENT_PORT;
  const lan = await lanAddress();
  const key = process.env.ADMIN_KEY || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '');
  console.log(`
  Admin:          http://localhost:${port}/admin
  Big screen:     http://localhost:${port}/screen
  Admin key:      ${key || '(see the quiz output with --verbose)'}

  Teams join at:  http://${lan ?? 'localhost'}:${port}${lan ? '' : '  (no network address found)'}

Ctrl-C stops all three.`);
}

// The address phones on the local network reach this machine at, from the quiz
// server, which puts private ranges first (a VPN address is not the one to show).
async function lanAddress() {
  try {
    const { addresses } = await (await fetch(`http://127.0.0.1:${QUIZ_PORT}/api/lan`)).json();
    return addresses[0] ?? null;
  } catch {
    return null;
  }
}
