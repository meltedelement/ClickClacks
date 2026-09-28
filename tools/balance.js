// Runs lots of headless matches between every pair of weapons and prints win rates.
// Usage: npm run balance [matchesPerPair]

import { CONFIG } from '../src/config.js';
import { Simulation } from '../src/sim/Simulation.js';
import { WEAPONS } from '../src/weapons/index.js';

const MATCHES = Number(process.argv[2] ?? 500);
const TIME_LIMIT = 180; // seconds of simulated time before calling it a draw
const DT = 1 / CONFIG.physicsHz;

function runMatch(lineup) {
  const sim = new Simulation(lineup);
  while (!sim.over && sim.time < TIME_LIMIT) sim.step(DT);
  return {
    winner: sim.winner?.weapon.constructor ?? null,
    time: sim.time,
    hpLeft: sim.winner?.hp ?? 0,
  };
}

const pct = (n) => `${((n / MATCHES) * 100).toFixed(1)}%`.padStart(6);

console.log(`${MATCHES} matches per pairing (sides alternate)\n`);

for (let i = 0; i < WEAPONS.length; i++) {
  for (let j = i + 1; j < WEAPONS.length; j++) {
    const A = WEAPONS[i];
    const B = WEAPONS[j];
    const wins = new Map([[A, 0], [B, 0], [null, 0]]);
    let totalTime = 0;
    let totalHpLeft = 0;

    for (let m = 0; m < MATCHES; m++) {
      const result = runMatch(m % 2 === 0 ? [A, B] : [B, A]);
      wins.set(result.winner, wins.get(result.winner) + 1);
      totalTime += result.time;
      totalHpLeft += result.hpLeft;
    }

    const decided = MATCHES - wins.get(null);
    console.log(
      `${A.displayName.padEnd(10)} ${pct(wins.get(A))}  vs  ${pct(wins.get(B))} ${B.displayName.padEnd(10)}` +
        `  draws ${pct(wins.get(null))}` +
        `  avg length ${(totalTime / MATCHES).toFixed(1)}s` +
        `  avg winner hp ${decided ? (totalHpLeft / decided).toFixed(1) : '-'}`,
    );
  }
}
