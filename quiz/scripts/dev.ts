// Runs the API server (restarts on change) and the Vite dev server together.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve vite's bin script and run it with the current node binary. Spawning
// `npx`/`vite` directly fails on Windows, where they are .cmd shims that
// child_process.spawn cannot execute without a shell.
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

const children = [
  spawn(process.execPath, ['--watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit' }),
];

function stop() {
  for (const child of children) child.kill();
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
