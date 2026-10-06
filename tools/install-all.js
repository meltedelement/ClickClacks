// Runs `npm install` in every module that has dependencies. The tournament
// service and party have none (they borrow the quiz's TypeScript for
// `npm run typecheck`, so install the quiz before typechecking them).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const MODULES = ['games/weapon-balls', 'apps/quiz-of-doom'];

for (const dir of MODULES) {
  console.log(`\n== npm install in ${dir}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
    cwd: path.join(ROOT, dir),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
