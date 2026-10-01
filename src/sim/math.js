// Small 2D vector helpers. Vectors are plain { x, y } objects.

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = (a) => Math.hypot(a.x, a.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const fromAngle = (angle, len = 1) => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len });

export function normalize(a) {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : vec(1, 0);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const randomRange = (lo, hi) => lo + Math.random() * (hi - lo);
export const randomSign = () => (Math.random() < 0.5 ? -1 : 1);

// Written out in scalars (here and below): collision tests call these for
// every blade every step, and the intermediate vectors add up.
export function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return { x: a.x, y: a.y };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

// Closest points between segments p1-q1 and p2-q2
// (Ericson, "Real-Time Collision Detection", 5.1.9).
export function closestPointsBetweenSegments(p1, q1, p2, q2) {
  const EPS = 1e-9;
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s;
  let t;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const c1 = { x: p1.x + d1x * s, y: p1.y + d1y * s };
  const c2 = { x: p2.x + d2x * t, y: p2.y + d2y * t };
  return { c1, c2, distance: Math.hypot(c1.x - c2.x, c1.y - c2.y) };
}

export const angleOf = (v) => Math.atan2(v.y, v.x);

// How far `target` is from `angle`, the short way round, in [-PI, PI).
export function angleDiff(angle, target) {
  return ((((target - angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

// Rotate `angle` towards `target` by at most `maxStep` radians, the short way round.
export function turnTowards(angle, target, maxStep) {
  return angle + clamp(angleDiff(angle, target), -maxStep, maxStep);
}
