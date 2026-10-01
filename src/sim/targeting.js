import { CONFIG } from '../config.js';
import { distance } from './math.js';

// Picking and measuring up enemies, for abilities and upgrades that only act
// when someone is close enough.
//
// Ranges are written as the centre-to-centre distance between two size-1
// balls. In a royale they grow with the balls: the gap between the two edges
// scales with the owner's size, and each ball's radius is added at its size.
// Radii here are nominal (size × CONFIG.ball.radius), not the balls' actual
// ones, so Compact never shortens its ball's ranges. With every size at 1 (any
// normal match) a range is exactly the plain centre distance.

// The enemy with the nearest edge (nominal radius), or null if none is left.
export function nearestEnemy(owner, sim) {
  const r = CONFIG.ball.radius;
  let nearest = null;
  let best = Infinity;
  for (const ball of sim.aliveBalls) {
    if (ball === owner) continue;
    const d = distance(ball.pos, owner.pos) - r * (ball.size - 1);
    if (d < best) {
      best = d;
      nearest = ball;
    }
  }
  return nearest;
}

// True if `enemy` is within `range` of `owner`, grown as described above.
export function withinRange(owner, enemy, range) {
  const r = CONFIG.ball.radius;
  return distance(enemy.pos, owner.pos) < range + (range - r) * (owner.size - 1) + r * (enemy.size - 1);
}
