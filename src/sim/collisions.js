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

export function bounceOffWalls(ball, arena) {
  const r = ball.radius;
  if (ball.pos.x < r) {
    ball.pos.x = r;
    ball.vel.x = Math.abs(ball.vel.x);
  } else if (ball.pos.x > arena.width - r) {
    ball.pos.x = arena.width - r;
    ball.vel.x = -Math.abs(ball.vel.x);
  }
  if (ball.pos.y < r) {
    ball.pos.y = r;
    ball.vel.y = Math.abs(ball.vel.y);
  } else if (ball.pos.y > arena.height - r) {
    ball.pos.y = arena.height - r;
    ball.vel.y = -Math.abs(ball.vel.y);
  }
}

// Equal-mass elastic bounce between two balls.
export function resolveBallCollision(a, b) {
  const delta = sub(b.pos, a.pos);
  const dist = length(delta);
  const minDist = a.radius + b.radius;
  if (dist >= minDist || dist < 1e-9) return;

  const n = scale(delta, 1 / dist);
  const push = (minDist - dist) / 2;
  a.pos.x -= n.x * push;
  a.pos.y -= n.y * push;
  b.pos.x += n.x * push;
  b.pos.y += n.y * push;

  const approach = dot(sub(a.vel, b.vel), n);
  if (approach <= 0) return;
  a.vel.x -= n.x * approach;
  a.vel.y -= n.y * approach;
  b.vel.x += n.x * approach;
  b.vel.y += n.y * approach;
}

// Returns the contact point if the weapon touches the ball, otherwise null.
export function weaponHitsBall(weapon, ball) {
  const { a, b } = weapon.getSegment();
  const point = closestPointOnSegment(ball.pos, a, b);
  return distance(point, ball.pos) < ball.radius + weapon.thickness ? point : null;
}

// Returns the contact point if the two weapons overlap, otherwise null.
export function weaponsClash(w1, w2) {
  const s1 = w1.getSegment();
  const s2 = w2.getSegment();
  const { c1, c2, distance: dist } = closestPointsBetweenSegments(s1.a, s1.b, s2.a, s2.b);
  return dist < w1.thickness + w2.thickness ? midpoint(c1, c2) : null;
}
