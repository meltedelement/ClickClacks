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

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq < 1e-9) return { ...a };
  const t = clamp(dot(sub(p, a), ab) / lenSq, 0, 1);
  return add(a, scale(ab, t));
}

// Closest points between segments p1-q1 and p2-q2
// (Ericson, "Real-Time Collision Detection", 5.1.9).
export function closestPointsBetweenSegments(p1, q1, p2, q2) {
  const EPS = 1e-9;
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
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

  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return { c1, c2, distance: distance(c1, c2) };
}

export const angleOf = (v) => Math.atan2(v.y, v.x);

// Rotate `angle` towards `target` by at most `maxStep` radians, the short way round.
export function turnTowards(angle, target, maxStep) {
  const diff = ((((target - angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return angle + clamp(diff, -maxStep, maxStep);
}
