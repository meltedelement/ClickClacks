import { CONFIG } from '../config.js';
import { angleDiff, distance, hypot } from './math.js';

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

// `range` (a cone's reach, centre-to-centre between two size-1 balls) at the
// owner's size: grown the way withinRange grows it.
export function scaledRange(owner, range) {
  return range + (range - CONFIG.ball.radius) * (owner.size - 1);
}

// True if any part of `enemy`'s ball is inside the cone from `owner`'s centre:
// pointing along `angle`, `half` rad either side, `range` long (grown in a
// royale, see scaledRange; `enemy` is measured to its centre).
export function inCone(owner, enemy, angle, half, range) {
  if (!withinRange(owner, enemy, range)) return false;
  const dx = enemy.pos.x - owner.pos.x;
  const dy = enemy.pos.y - owner.pos.y;
  const d = hypot(dx, dy);
  // The ball's own width widens what it takes up of the cone.
  const width = d > enemy.radius ? Math.asin(enemy.radius / d) : Math.PI;
  return Math.abs(angleDiff(angle, Math.atan2(dy, dx))) <= half + width;
}

// The enemy with the nearest edge among those inside the cone, or null.
export function enemyInCone(owner, angle, half, range, sim) {
  const r = CONFIG.ball.radius;
  let found = null;
  let best = Infinity;
  for (const ball of sim.aliveBalls) {
    if (ball === owner || !inCone(owner, ball, angle, half, range)) continue;
    const d = distance(ball.pos, owner.pos) - r * (ball.size - 1);
    if (d < best) {
      best = d;
      found = ball;
    }
  }
  return found;
}
