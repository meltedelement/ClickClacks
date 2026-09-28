// Runs the API server (restarts on change) and the Vite dev server together.
import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['--watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];

function stop() {
  for (const child of children) child.kill();
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
