import {
  closestPointOnSegment,
  closestPointsBetweenSegments,
  distance,
  dot,
  length,
  midpoint,
  scale,
  sub,
} from './math.js';

// Keeps the ball inside the arena. Returns true if it bounced off a wall.
export function bounceOffWalls(ball, arena) {
  const r = ball.radius;
  let bounced = false;
  if (ball.pos.x < r) {
    ball.pos.x = r;
    ball.vel.x = Math.abs(ball.vel.x);
    bounced = true;
  } else if (ball.pos.x > arena.width - r) {
    ball.pos.x = arena.width - r;
    ball.vel.x = -Math.abs(ball.vel.x);
    bounced = true;
  }
  if (ball.pos.y < r) {
    ball.pos.y = r;
    ball.vel.y = Math.abs(ball.vel.y);
    bounced = true;
  } else if (ball.pos.y > arena.height - r) {
    ball.pos.y = arena.height - r;
    ball.vel.y = -Math.abs(ball.vel.y);
    bounced = true;
  }
  return bounced;
}

// Elastic bounce between two balls. Balls are equal mass except in a royale,
// where a ball that has grown is heavier (Ball.mass). An unstoppable ball acts
// as if it had infinite mass: the other ball takes all the push and bounces off it.
// Returns true if the balls were touching.
export function resolveBallCollision(a, b) {
  // Most pairs are far apart (a royale has thousands of them): skip those
  // before building any vectors. The 1 px margin leaves the exact test below
  // to decide pairs near touching, so matches play out as they did without this.
  const minDist = a.radius + b.radius;
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  if (dx * dx + dy * dy > (minDist + 1) * (minDist + 1)) return false;
  const delta = sub(b.pos, a.pos);
  const dist = length(delta);
  if (dist >= minDist || dist < 1e-9) return false;

  const aHeavy = a.weapon.unstoppable;
  const bHeavy = b.weapon.unstoppable;
  const aShare = aHeavy === bHeavy ? (a.mass === b.mass ? 0.5 : b.mass / (a.mass + b.mass)) : aHeavy ? 0 : 1;
  const bShare = 1 - aShare;

  const n = scale(delta, 1 / dist);
  const overlap = minDist - dist;
  a.pos.x -= n.x * overlap * aShare;
  a.pos.y -= n.y * overlap * aShare;
  b.pos.x += n.x * overlap * bShare;
  b.pos.y += n.y * overlap * bShare;

  const approach = dot(sub(a.vel, b.vel), n);
  if (approach > 0) {
    a.vel.x -= n.x * approach * 2 * aShare;
    a.vel.y -= n.y * approach * 2 * aShare;
    b.vel.x += n.x * approach * 2 * bShare;
    b.vel.y += n.y * approach * 2 * bShare;
  }
  return true;
}

// Each test below first checks the two centres are close enough for the
// hitboxes to possibly touch (the reach getters on Weapon and Shield); most
// steps they aren't, and that skips building segments and the segment maths.
// The margin covers rounding between the reach bound and the real segments.
const REACH_MARGIN = 1e-6;

function inReach(p, q, reach) {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const r = reach + REACH_MARGIN;
  return dx * dx + dy * dy < r * r;
}

// Returns the contact point if any blade of the weapon touches the ball, otherwise null.
export function weaponHitsBall(weapon, ball) {
  if (!inReach(weapon.owner.pos, ball.pos, weapon.bladeReach + ball.radius)) return null;
  for (const { a, b } of weapon.getSegments()) {
    const point = closestPointOnSegment(ball.pos, a, b);
    if (distance(point, ball.pos) < ball.radius + weapon.thickness) return point;
  }
  return null;
}

// Returns the contact point if the shield (plus any spikes on it) touches the ball, otherwise null.
export function shieldHitsBall(shield, ball) {
  if (!inReach(shield.weapon.owner.pos, ball.pos, shield.reach + shield.spikeLength + ball.radius)) return null;
  const { a, b } = shield.getSegment();
  const point = closestPointOnSegment(ball.pos, a, b);
  if (distance(point, ball.pos) < ball.radius + shield.thickness + shield.spikeLength) return point;
  return null;
}

// Returns the contact point if any blades of the two weapons overlap, otherwise null.
export function weaponsClash(w1, w2) {
  if (!inReach(w1.owner.pos, w2.owner.pos, w1.bladeReach + w2.bladeReach)) return null;
  return firstContact(w1.getSegments(), w2.getSegments(), w1.thickness + w2.thickness);
}

// Returns the contact point if any blade of the weapon touches the shield, otherwise null.
export function weaponHitsShield(weapon, shield) {
  if (!inReach(weapon.owner.pos, shield.weapon.owner.pos, weapon.bladeReach + shield.reach)) return null;
  return firstContact(weapon.getSegments(), [shield.getSegment()], weapon.thickness + shield.thickness);
}

function firstContact(segmentsA, segmentsB, reach) {
  for (const s1 of segmentsA) {
    for (const s2 of segmentsB) {
      const { c1, c2, distance: dist } = closestPointsBetweenSegments(s1.a, s1.b, s2.a, s2.b);
      if (dist < reach) return midpoint(c1, c2);
    }
  }
  return null;
}
