import { closestPointsBetweenSegments, hypot } from '../sim/math.js';

// Shared by the weapons that shoot things (Gun's bullets, Wand's orbs).

// Where a projectile of `weapon`'s, `reach` px in half-width, moving from `a`
// to `b`, runs into one of `enemy`'s blades, held shields or drones, as
// { point, shield, drone? }, or null. Follows the engine's blocking rules: an
// unblockable weapon on either side passes through blades, only ours through
// shields, and a guard-broken ball can't block. Drones follow their own (see
// Drone.strike): a guarding drone doesn't stop a projectile but takes its share
// off the hit, as usual. With `drones` false, drones don't stop it at all, and
// drones in `skip` (an array, or null) are passed over.
export function projectileBlockedBy(weapon, a, b, enemy, reach, drones = true, skip = null) {
  if (weapon.unblockable || enemy.guardBroken) return null;
  const theirs = enemy.weapon;
  // Drones fly far from their ball, so they aren't covered by guardReach below.
  if (drones && theirs.drones) {
    const guards = theirs.guardingDrones;
    for (const drone of theirs.drones) {
      if (!theirs.swattable(drone) || guards.includes(drone) || (skip !== null && skip.includes(drone))) continue;
      const s = theirs.droneSegment(drone);
      const point = contact(a, b, s.a, s.b, reach + theirs.thickness);
      if (point) return { point, shield: false, drone };
    }
  }
  // Too far from the enemy for its blades or shields to be in the way. The usual case.
  const half = hypot(b.x - a.x, b.y - a.y) / 2;
  const gap = hypot((a.x + b.x) / 2 - enemy.pos.x, (a.y + b.y) / 2 - enemy.pos.y);
  if (gap >= theirs.guardReach + reach + half + 1e-6) return null;
  if (!theirs.unblockable) {
    for (const s of theirs.getSegments()) {
      const point = contact(a, b, s.a, s.b, reach + theirs.thickness);
      if (point) return { point, shield: false };
    }
  }
  for (const shield of theirs.heldShields) {
    const s = shield.getSegment();
    const point = contact(a, b, s.a, s.b, reach + shield.thickness);
    if (point) return { point, shield: true };
  }
  return null;
}

// Midpoint of the closest approach of segments a-b and c-d, if it's under `reach`, otherwise null.
export function contact(a, b, c, d, reach) {
  const { c1, c2, distance: dist } = closestPointsBetweenSegments(a, b, c, d);
  return dist < reach ? { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 } : null;
}
