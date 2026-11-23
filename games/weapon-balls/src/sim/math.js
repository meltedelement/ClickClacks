// Small 2D vector helpers. Vectors are plain { x, y } objects.

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = (a) => hypot(a.x, a.y);
export const distance = (a, b) => hypot(a.x - b.x, a.y - b.y);

// Math.hypot(x, y), to the bit, but about three times as fast: V8's takes any
// number of arguments and allocates for them, and the sim calls it a dozen
// times a step. V8 divides by the larger argument and adds the squares with
// Kahan summation, which for two numbers comes to exactly the formula below.
// A check on load makes sure this engine's Math.hypot agrees (other engines'
// round differently); if not, or while exactMath has swapped its own in (a
// shared match, see exactMath.js), this is just Math.hypot. Use it rather than
// Math.hypot in the sim, for two numbers.
const nativeHypot = Math.hypot;

function v8Hypot(x, y) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const max = Math.max(ax, ay);
  // 0, Infinity and NaN (where Infinity wins) are left to Math.hypot.
  if (!(max > 0 && max < Infinity)) return nativeHypot(x, y);
  const r = Math.min(ax, ay) / max;
  return Math.sqrt(1 + r * r) * max;
}

const v8HypotIsExact = (() => {
  let seed = 0x9e3779b9;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5;
  for (let i = 0; i < 3000; i++) {
    const scale = [1e-3, 1, 30, 1000, 1e6][i % 5];
    const x = next() * scale;
    const y = next() * (i % 3 === 0 ? scale : 1000);
    if (v8Hypot(x, y) !== nativeHypot(x, y)) return false;
  }
  return true;
})();

export function hypot(x, y) {
  if (!v8HypotIsExact || Math.hypot !== nativeHypot) return Math.hypot(x, y);
  return v8Hypot(x, y);
}
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
  return { c1, c2, distance: hypot(c1.x - c2.x, c1.y - c2.y) };
}

export const angleOf = (v) => Math.atan2(v.y, v.x);

// How far `target` is from `angle`, the short way round, in [-PI, PI).
export function angleDiff(angle, target) {
  return remainder(remainder(target - angle + Math.PI, TAU) + TAU, TAU) - Math.PI;
}

// x % y for a positive y, to the bit. V8 turns % on fractions into a call to
// C's fmod; within two y of 0 (the second remainder in angleDiff always is)
// one exact add or subtract gives the same answer.
function remainder(x, y) {
  if (x >= 0) {
    if (x < y) return x;
    if (x < 2 * y) return x - y; // exact, as y <= x < 2y
  } else if (x > -y) {
    return x;
  } else if (x > -2 * y) {
    return x + y || -0; // exact; % keeps x's sign, so a zero is -0
  }
  return x % y;
}

// Rotate `angle` towards `target` by at most `maxStep` radians, the short way round.
export function turnTowards(angle, target, maxStep) {
  return angle + clamp(angleDiff(angle, target), -maxStep, maxStep);
}
