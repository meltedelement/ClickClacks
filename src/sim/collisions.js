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

// Elastic bounce between two equal-mass balls. An unstoppable ball acts as if
// it had infinite mass: the other ball takes all the push and bounces off it.
export function resolveBallCollision(a, b) {
  const delta = sub(b.pos, a.pos);
  const dist = length(delta);
  const minDist = a.radius + b.radius;
  if (dist >= minDist || dist < 1e-9) return;

  const aHeavy = a.weapon.unstoppable;
  const bHeavy = b.weapon.unstoppable;
  const aShare = aHeavy === bHeavy ? 0.5 : aHeavy ? 0 : 1;
  const bShare = 1 - aShare;

  const n = scale(delta, 1 / dist);
  const overlap = minDist - dist;
  a.pos.x -= n.x * overlap * aShare;
  a.pos.y -= n.y * overlap * aShare;
  b.pos.x += n.x * overlap * bShare;
  b.pos.y += n.y * overlap * bShare;

  const approach = dot(sub(a.vel, b.vel), n);
  if (approach <= 0) return;
  a.vel.x -= n.x * approach * 2 * aShare;
  a.vel.y -= n.y * approach * 2 * aShare;
  b.vel.x += n.x * approach * 2 * bShare;
  b.vel.y += n.y * approach * 2 * bShare;
}

// Returns the contact point if any blade of the weapon touches the ball, otherwise null.
export function weaponHitsBall(weapon, ball) {
  for (const { a, b } of weapon.getSegments()) {
    const point = closestPointOnSegment(ball.pos, a, b);
    if (distance(point, ball.pos) < ball.radius + weapon.thickness) return point;
  }
  return null;
}

// Returns the contact point if the shield (plus any spikes on it) touches the ball, otherwise null.
export function shieldHitsBall(shield, ball) {
  const { a, b } = shield.getSegment();
  const point = closestPointOnSegment(ball.pos, a, b);
  if (distance(point, ball.pos) < ball.radius + shield.thickness + shield.spikeLength) return point;
  return null;
}

// Returns the contact point if any blades of the two weapons overlap, otherwise null.
export function weaponsClash(w1, w2) {
  return firstContact(w1.getSegments(), w2.getSegments(), w1.thickness + w2.thickness);
}

// Returns the contact point if any blade of the weapon touches the shield, otherwise null.
export function weaponHitsShield(weapon, shield) {
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
