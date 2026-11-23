import { TAU } from '../sim/math.js';

// How the Drone's transformations look: the drone hulls they swap in (see
// Drone.drawLocal and `weapon.hull`) and what they put on the ball. Drawing
// only; nothing here changes a fight.
//
// Hulls are drawn like Drone.drawLocal: pointing along +x from `start` (the
// tail) to `start + len` (the nose), at size 1, y already stretched by the
// Drone's widthScale. `clock` is the Drone's running time, for anything that spins
// or flickers.

const OUTLINE = '#f4f1e8';
const STEEL = '#d9dee4';
export const FIRE = '#ff8a3d';
export const FIRE_CORE = '#ffd23f';
export const BUMPER = '#2b2b30';
const JET = '#3a404b';
const ARMOR = '#8d949c';
const ARMOR_EDGE = '#3f444b';
const CORE = '#7fe6ff';
const RADAR = '#7dffb0';

// A closed outline from points (t along the drone, y) for the top half,
// nose first, mirrored for the bottom.
function mirrored(ctx, start, len, half) {
  ctx.beginPath();
  half.forEach(([t, y], i) => (i === 0 ? ctx.moveTo(start + len * t, y) : ctx.lineTo(start + len * t, y)));
  for (let i = half.length - 1; i >= 0; i--) {
    const [t, y] = half[i];
    if (y !== 0) ctx.lineTo(start + len * t, -y);
  }
  ctx.closePath();
}

function body(ctx, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
}

// ---- Hulls ------------------------------------------------------------------------

// Fighters: a sleek dark jet, a stripe in the ball's colour down its spine and on its wingtips.
export function drawJet(ctx, start, len, color) {
  const x = (t) => start + len * t;
  ctx.save();
  const hull = () =>
    mirrored(ctx, start, len, [
      [1.12, 0],
      [0.86, -1.3],
      [0.56, -1.6],
      [0.2, -7.2],
      [0.1, -7.2],
      [0.16, -1.6],
      [0.04, -1.6],
      [-0.07, -3.9],
      [-0.12, -3.9],
      [-0.05, -1],
    ]);
  hull();
  ctx.fillStyle = JET;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x(0.08), -7.5, len * 0.14, 2.6); // wingtips
  ctx.fillRect(x(0.08), 4.9, len * 0.14, 2.6);
  ctx.fillRect(x(0.02), -0.8, len * 0.96, 1.6); // spine
  ctx.restore();
  hull();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // Canopy, tinted
  ctx.fillStyle = '#1b2733';
  ctx.beginPath();
  ctx.ellipse(x(0.74), 0, len * 0.12, 1.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(159, 224, 255, 0.8)';
  ctx.beginPath();
  ctx.ellipse(x(0.77), -0.4, len * 0.05, 0.4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Ace: a little biplane, its propeller spinning on the nose.
export function drawBiplane(ctx, start, len, color, clock) {
  const x = (t) => start + len * t;
  ctx.save();
  // Tailplane
  ctx.beginPath();
  ctx.roundRect(x(-0.02), -4.5, len * 0.16, 9, 1.2);
  body(ctx, color);
  // Fuselage
  mirrored(ctx, start, len, [
    [0.94, -1.6],
    [0.86, -2.4],
    [0.62, -2.5],
    [0.02, -1.1],
  ]);
  body(ctx, color);
  // Wing, with a roundel near each tip
  ctx.beginPath();
  ctx.roundRect(x(0.46), -8.5, len * 0.24, 17, 1.5);
  body(ctx, color);
  for (const side of [-1, 1]) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(x(0.58), side * 5.8, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c8262c';
    ctx.beginPath();
    ctx.arc(x(0.58), side * 5.8, 0.7, 0, TAU);
    ctx.fill();
  }
  // Propeller: a blur, and the blade seen edge-on as it turns
  const blade = 6.5 * Math.cos(clock * 45);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x(1.0), 0, 1.2, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#2b2b30';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x(1.0), -blade);
  ctx.lineTo(x(1.0), blade);
  ctx.stroke();
  ctx.fillStyle = '#2b2b30';
  ctx.beginPath();
  ctx.arc(x(0.97), 0, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Legion: a little insect bot, its wings a buzzing blur.
export function drawBug(ctx, start, len, color, clock, seed = 0) {
  const x = (t) => start + len * t;
  ctx.save();
  // Wings, drawn twice a little apart for the blur
  const buzz = Math.abs(Math.sin(clock * 70 + seed));
  ctx.fillStyle = 'rgba(235, 245, 255, 0.4)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 0.8;
  for (const side of [-1, 1]) {
    for (const spread of [0.35, 0.75]) {
      ctx.beginPath();
      ctx.ellipse(x(0.48), side * (3.5 + buzz), len * 0.3, 2.4, side * (spread + buzz * 0.2), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  // Abdomen, with stripes
  ctx.beginPath();
  ctx.ellipse(x(0.3), 0, len * 0.3, 3.4, 0, 0, TAU);
  body(ctx, color);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const t of [0.18, 0.32]) {
    ctx.moveTo(x(t), -4);
    ctx.lineTo(x(t), 4);
  }
  ctx.stroke();
  ctx.restore();
  // Thorax and head
  ctx.beginPath();
  ctx.ellipse(x(0.64), 0, len * 0.14, 2.6, 0, 0, TAU);
  body(ctx, color);
  ctx.fillStyle = '#2b2b30';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x(0.86), 0, 2.3, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff5d73';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x(0.9), side * 1.1, 0.7, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// Daredevils: a hot rod with flames painted on, a spoiler, and its exhaust always burning.
export function drawHotRod(ctx, start, len, color, clock, seed = 0) {
  const x = (t) => start + len * t;
  ctx.save();
  // Exhaust
  const flicker = 0.8 + 0.2 * Math.sin(clock * 47 + seed) + 0.1 * Math.sin(clock * 83 + seed * 2);
  for (const [fill, reach, width] of [[FIRE, 10, 3], [FIRE_CORE, 6, 1.6]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x(0.04), -width);
    ctx.quadraticCurveTo(x(0) - reach * flicker * 0.5, -width, x(0) - reach * flicker, 0);
    ctx.quadraticCurveTo(x(0) - reach * flicker * 0.5, width, x(0.04), width);
    ctx.closePath();
    ctx.fill();
  }
  // Spoiler
  ctx.fillStyle = BUMPER;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x(-0.02), -5.5, len * 0.14, 11, 1);
  ctx.fill();
  ctx.stroke();
  // Body
  const hull = () =>
    mirrored(ctx, start, len, [
      [1.08, 0],
      [0.75, -2.4],
      [0.3, -3.6],
      [0.06, -3.2],
      [0.02, -1.8],
    ]);
  hull();
  body(ctx, color);
  // Flames painted from the nose back
  ctx.save();
  hull();
  ctx.clip();
  for (const [fill, scale] of [[FIRE, 1], [FIRE_CORE, 0.6]]) {
    const tip = 0.92;
    const t = (v) => x(tip - (tip - v) * scale);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x(tip), 0);
    ctx.quadraticCurveTo(t(0.55), -3.4 * scale, t(0.12), -2.6 * scale);
    ctx.quadraticCurveTo(t(0.4), -1.6 * scale, t(0.22), -0.6 * scale);
    ctx.quadraticCurveTo(t(0.45), 0, t(0.22), 0.6 * scale);
    ctx.quadraticCurveTo(t(0.4), 1.6 * scale, t(0.12), 2.6 * scale);
    ctx.quadraticCurveTo(t(0.55), 3.4 * scale, x(tip), 0);
    ctx.fill();
  }
  ctx.restore();
  hull();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// Slicers: a spinning circular saw, its hub in the ball's colour.
export function drawSawDisc(ctx, start, len, color, clock) {
  const cx = start + len * 0.5;
  const radius = len * 0.5;
  const teeth = 10;
  const step = TAU / teeth;
  const turn = clock * 25;
  ctx.save();
  ctx.fillStyle = STEEL;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = turn + i * step;
    const inner = radius * 0.72;
    const p = (angle, r) => [cx + Math.cos(angle) * r, Math.sin(angle) * r];
    const [ax, ay] = p(a, inner);
    const [tx, ty] = p(a + step * 0.7, radius);
    const [bx, by] = p(a + step, inner);
    if (i === 0) ctx.moveTo(ax, ay);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx, by);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, 0, radius * 0.48, 0, TAU);
  body(ctx, color);
  ctx.fillStyle = '#2b2b30';
  ctx.beginPath();
  ctx.arc(cx, 0, 1.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Fortress: a chunky drone, thick armour slabs down its flanks and a glowing
// core, a slab cracked once it has been knocked away.
export function drawHeavyDrone(ctx, start, len, color, cracked, clock) {
  const x = (t) => start + len * t;
  ctx.save();
  // Body
  mirrored(ctx, start, len, [
    [1.04, 0],
    [0.86, -4.4],
    [0.14, -4.4],
    [-0.02, -2.2],
  ]);
  body(ctx, color);
  // Armour slabs
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x(0.9), side * 3.6);
    ctx.lineTo(x(0.76), side * 7.4);
    ctx.lineTo(x(0.1), side * 7.4);
    ctx.lineTo(x(0.0), side * 3.6);
    ctx.closePath();
    ctx.fillStyle = ARMOR;
    ctx.fill();
    ctx.strokeStyle = ARMOR_EDGE;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x(0.74), side * 6.6);
    ctx.lineTo(x(0.14), side * 6.6);
    ctx.stroke();
    ctx.fillStyle = '#e3e6ea';
    for (const t of [0.22, 0.66]) {
      ctx.beginPath();
      ctx.arc(x(t), side * 5.4, 0.8, 0, TAU);
      ctx.fill();
    }
    if (cracked && side === 1) {
      ctx.strokeStyle = '#1d1d22';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x(0.38), 3.8);
      ctx.lineTo(x(0.46), 5.4);
      ctx.lineTo(x(0.4), 6.2);
      ctx.lineTo(x(0.5), 7.3);
      ctx.stroke();
    }
  }
  // Core
  ctx.fillStyle = CORE;
  ctx.shadowColor = CORE;
  ctx.shadowBlur = 5 + 2 * Math.sin(clock * 4);
  ctx.beginPath();
  ctx.arc(x(0.5), 0, 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Non-Euclidean: an impossible triangle, a corner pointing forward.
// Three square bars, along x, then y, then z, seen from (1, 1, 1): the top of
// the last lands exactly where the first starts. Each corner cube belongs to
// one bar. Each bar is drawn over the one before it, which can't all be true:
// the z bar is split, its top drawn first (under the x bar) and its bottom
// last (over the y bar).
const PENROSE = penroseFaces(4.4);

function penroseFaces(n) {
  const project = ([x, y, z]) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  // `top: false` leaves off the +z face, for a piece cut from under another.
  const box = ([x0, x1], [y0, y1], [z0, z1], top = true) => [
    // +z, +x, +y: the faces turned towards the viewer, lightest first
    ...(top ? [{ shade: 0, pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] }] : []),
    { shade: 1, pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { shade: 2, pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
  ];
  const split = n / 2;
  const bars = [
    box([n - 1, n], [n - 1, n], [split, n]), // top of the z bar, ending where x begins
    box([0, n - 1], [0, 1], [0, 1]), // along x, up to the first corner
    box([n - 1, n], [0, n - 1], [0, 1]), // the first corner, then along y
    box([n - 1, n], [n - 1, n], [0, split], false), // the second corner and the bottom of z
  ];
  // An edge along the cut is inside the bar: filled but not outlined.
  const faces = bars.flat().map(({ shade, pts }) => ({
    shade,
    pts: pts.map(project),
    cut: pts.map((p, i) => p[2] === split && pts[(i + 1) % pts.length][2] === split && p[0] >= n - 1 && p[1] >= n - 1),
  }));
  // Normalise: centred, the tip pointing along +x, unit width along x
  const all = faces.flatMap((f) => f.pts);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const w = maxX - minX;
  for (const f of faces) f.pts = f.pts.map(([px, py]) => [(px - minX) / w, (py - (minY + maxY) / 2) / w]);
  return { faces, aspect: (maxY - minY) / w };
}

const SHADES = ['rgba(255, 255, 255, 0.18)', 'rgba(0, 0, 0, 0.18)', 'rgba(0, 0, 0, 0.45)'];

// An impossible triangle filling `width` along x from `x0`, centred on y = 0.
export function drawPenrose(ctx, x0, width, color, outline = OUTLINE, lineWidth = 1) {
  ctx.save();
  ctx.lineJoin = 'round';
  const at = ([px, py]) => [x0 + px * width, py * width];
  for (const { shade, pts, cut } of PENROSE.faces) {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = SHADES[shade];
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (cut[i]) return;
      ctx.moveTo(...at(p));
      ctx.lineTo(...at(pts[(i + 1) % pts.length]));
    });
    ctx.stroke();
  }
  ctx.restore();
}

export function drawImpossibleDrone(ctx, start, len, color) {
  // Its height is PENROSE.aspect × its width; kept about as tall as a plain drone.
  const width = Math.min(len * 1.05, 14 / PENROSE.aspect);
  drawPenrose(ctx, start + (len - width) / 2, width, color, OUTLINE, 0.9);
}

// Wingmen: a round puck with a thick rubber rim, like a bumper car, a light at the front.
export function drawPuck(ctx, start, len, color) {
  const cx = start + len * 0.5;
  const radius = 7.5;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, 0, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = BUMPER;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, 0, radius + 0.6, -2.4, -1.4);
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, 0, radius * 0.55, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#fff6c2';
  ctx.beginPath();
  ctx.arc(cx + radius * 0.6, 0, 1.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- On the ball --------------------------------------------------------------------

// Ace: a leather flying cap with fleece trim, ear flaps, and goggles pushed up on it.
export function drawAviatorCap(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  const edgeY = y - r * 0.2; // where the trim meets the ball's side
  const browY = y - r * 0.62; // its control point over the forehead
  ctx.save();
  ctx.lineJoin = 'round';

  // Ear flaps
  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#6b4325';
    ctx.strokeStyle = '#3e2512';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + dir * (r * 0.74), y - r * 0.45);
    ctx.lineTo(x + dir * (r + 2.5), y - r * 0.32);
    ctx.lineTo(x + dir * (r + 2.5), y + r * 0.12);
    ctx.quadraticCurveTo(x + dir * (r + 2), y + r * 0.32, x + dir * (r * 0.8), y + r * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Cap
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, TAU);
  ctx.clip();
  const cap = new Path2D();
  cap.moveTo(x - r - 3, edgeY);
  cap.quadraticCurveTo(x, browY - r * 0.2, x + r + 3, edgeY);
  cap.lineTo(x + r + 3, y - r - 3);
  cap.lineTo(x - r - 3, y - r - 3);
  cap.closePath();
  const leather = ctx.createLinearGradient(x, y - r, x, edgeY);
  leather.addColorStop(0, '#9a6a3e');
  leather.addColorStop(1, '#6b4325');
  ctx.fillStyle = leather;
  ctx.fill(cap);
  ctx.restore();
  // Stitched seam over the crown
  ctx.strokeStyle = '#3e2512';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(x, y - r - 1);
  ctx.lineTo(x, y - r * 0.74);
  ctx.stroke();
  ctx.setLineDash([]);
  // Fleece trim
  ctx.strokeStyle = '#efe3c8';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r + 1, edgeY - 1);
  ctx.quadraticCurveTo(x, browY - r * 0.2, x + r - 1, edgeY - 1);
  ctx.stroke();

  // Goggles: a strap across, two brass-rimmed lenses
  const gy = y - r * 0.66;
  ctx.strokeStyle = '#3e2512';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.9, gy + r * 0.12);
  ctx.quadraticCurveTo(x, gy - r * 0.1, x + r * 0.9, gy + r * 0.12);
  ctx.stroke();
  for (const dir of [-1, 1]) {
    const cx = x + dir * r * 0.27;
    ctx.fillStyle = '#7fc2dc';
    ctx.strokeStyle = '#b08d57';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, gy, r * 0.18, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.06, gy - r * 0.06, r * 0.06, r * 0.035, -0.6, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = '#b08d57';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.09, gy);
  ctx.lineTo(x + r * 0.09, gy);
  ctx.stroke();
  ctx.restore();
}

// Fighters: a radar sweep turning across the top of the ball.
export function drawRadarSweep(ctx, { pos, radius: r }, clock) {
  const { x, y } = pos;
  const floor = y - r * 0.3; // stays above the number
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, TAU);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(x - r, y - r, r * 2, floor - (y - r));
  ctx.clip();
  ctx.fillStyle = 'rgba(10, 30, 20, 0.35)';
  ctx.fillRect(x - r, y - r, r * 2, r);
  // Rings
  ctx.strokeStyle = RADAR;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const k of [0.45, 0.7, 0.95]) {
    ctx.moveTo(x + r * k, y);
    ctx.arc(x, y, r * k, 0, TAU);
  }
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - r);
  ctx.stroke();
  // Sweep: back and forth across the top, a fading wedge behind the line
  const swing = Math.sin(clock * 1.8);
  const a = -Math.PI / 2 + swing * 1.1;
  const trail = Math.cos(clock * 1.8) > 0 ? -0.5 : 0.5;
  ctx.globalAlpha = 1;
  ctx.fillStyle = RADAR;
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = 0.16 * (1 - i / 6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const from = a + (trail * i) / 6;
    const to = a + (trail * (i + 1)) / 6;
    ctx.arc(x, y, r, Math.min(from, to), Math.max(from, to));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = RADAR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  ctx.stroke();
  ctx.restore();
  // Edge of the screen
  ctx.save();
  ctx.strokeStyle = RADAR;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  const half = Math.sqrt(r * r - (y - floor) * (y - floor));
  ctx.beginPath();
  ctx.moveTo(x - half, floor);
  ctx.lineTo(x + half, floor);
  ctx.stroke();
  ctx.restore();
}

// Legion: a pair of antennae bobbing on top of the ball.
export function drawAntennae(ctx, { pos, radius: r }, clock) {
  const { x, y } = pos;
  ctx.save();
  ctx.strokeStyle = '#2b2b30';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    const bob = Math.sin(clock * 6 + dir) * 2.5;
    const base = { x: x + dir * r * 0.28, y: y - r * 0.95 };
    const tip = { x: x + dir * r * 0.6 + bob * 0.5, y: y - r - 20 + bob };
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(base.x + dir * 2, tip.y + 4, tip.x, tip.y);
    ctx.stroke();
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(tip.x - 1.1, tip.y - 1.1, 1.1, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// Daredevils: flames licking up the ball from underneath.
export function drawBallFlames(ctx, { pos, radius: r }, clock) {
  const { x, y } = pos;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  const tongues = 7;
  for (const [fill, height, alpha] of [[FIRE, 1, 0.9], [FIRE_CORE, 0.55, 0.95]]) {
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x - r, y + r);
    for (let i = 0; i < tongues; i++) {
      const left = x - r + (i * 2 * r) / tongues;
      const width = (2 * r) / tongues;
      const side = Math.abs(left + width / 2 - x) / r; // 0 middle .. 1 edge
      const flick = Math.sin(clock * 11 + i * 1.9) * r * 0.06;
      const tipY = y + r * (0.78 - (0.42 + 0.5 * side * side) * height) + flick;
      const lean = Math.sin(clock * 7 + i) * width * 0.15;
      ctx.quadraticCurveTo(left + width * 0.1, y + r * 0.5 * height + r * 0.4, left + width * 0.5 + lean, tipY);
      ctx.quadraticCurveTo(left + width * 0.9, y + r * 0.5 * height + r * 0.4, left + width, y + r * (1 - 0.2 * height));
    }
    ctx.lineTo(x + r, y + r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Slicers: a ring of saw teeth turning round the ball's edge.
export function drawSawRing(ctx, { pos, radius: r }, clock) {
  const { x, y } = pos;
  const teeth = 20;
  const step = TAU / teeth;
  const turn = clock * 2.5;
  ctx.save();
  ctx.fillStyle = STEEL;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = turn + i * step;
    const at = (angle, d) => [x + Math.cos(angle) * d, y + Math.sin(angle) * d];
    const [ax, ay] = at(a, r - 1);
    const [tx, ty] = at(a + step * 0.75, r + 7);
    const [bx, by] = at(a + step, r - 1);
    ctx.moveTo(ax, ay);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx, by);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#7d858f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + 0.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// Fortress: riveted armour plates bolted round the ball's rim.
export function drawArmorRim(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  const plates = 6;
  const step = TAU / plates;
  const gap = 0.07;
  const inner = r - 6;
  const outer = r + 2.5;
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < plates; i++) {
    const a0 = -Math.PI / 2 + step / 2 + i * step + gap;
    const a1 = a0 + step - gap * 2;
    ctx.beginPath();
    ctx.arc(x, y, outer, a0, a1);
    ctx.arc(x, y, inner, a1, a0, true);
    ctx.closePath();
    const shine = ctx.createRadialGradient(x, y, inner, x, y, outer);
    shine.addColorStop(0, '#6f7780');
    shine.addColorStop(0.6, '#a9b0b8');
    shine.addColorStop(1, '#7d858f');
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.strokeStyle = ARMOR_EDGE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#e3e6ea';
    for (const a of [a0 + 0.12, a1 - 0.12]) {
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (r - 1.8), y + Math.sin(a) * (r - 1.8), 1.3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Wingmen: a little radar dish on the ball, turned towards `target` (a wingman), if any.
export function drawRadarDish(ctx, { pos, radius: r }, target, clock) {
  const base = { x: pos.x + r * 0.4, y: pos.y - r * 0.9 };
  const pivot = { x: base.x + 2, y: base.y - 12 };
  let facing = target ? Math.atan2(target.y - pivot.y, target.x - pivot.x) : -Math.PI / 2 + Math.sin(clock * 1.5) * 0.8;
  // Keep it pointing somewhere upwards
  if (facing > 0) facing = facing > Math.PI / 2 ? -Math.PI + 0.25 : -0.25;
  facing = Math.max(-Math.PI + 0.25, Math.min(-0.25, facing));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5d6672';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(pivot.x, pivot.y);
  ctx.stroke();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(facing);
  ctx.scale(1.5, 1.5);
  // Bowl, opening along +x, and the feed sticking out of it
  ctx.fillStyle = '#e3e6ea';
  ctx.strokeStyle = '#5d6672';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(6, 0, 8, Math.PI - 0.95, Math.PI + 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-1.5, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.fillStyle = '#ff5d73';
  ctx.beginPath();
  ctx.arc(6, 0, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- Non-Euclidean on the ball --------------------------------------------------------

// In a flat world, one ball is a real sphere: lit from the top left, with a
// soft shadow on the floor (drawSphereShadow, under the ball), then shading,
// bounce light, a softbox reflection and a specular glint over it
// (drawPhotoSphere). The middle stays clear enough to read the number.
const LIGHT = { x: -0.42, y: -0.48 }; // where the light hits, in radii from the centre

export function drawSphereShadow(ctx, { pos, radius: r }) {
  const cx = pos.x + r * 0.28;
  const cy = pos.y + r * 0.34;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.92);
  const shadow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.18);
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  shadow.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.18, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawPhotoSphere(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  const lx = x + LIGHT.x * r;
  const ly = y + LIGHT.y * r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, TAU); // over the flat outline too: a real sphere has none
  ctx.clip();

  // Diffuse shading: bright towards the light, falling off into a core shadow
  const shade = ctx.createRadialGradient(lx, ly, 0, x, y, r + 1.5);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  shade.addColorStop(0.3, 'rgba(255, 255, 255, 0.06)');
  shade.addColorStop(0.55, 'rgba(0, 0, 0, 0.04)');
  shade.addColorStop(0.82, 'rgba(0, 0, 0, 0.38)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);

  // Bounce light off the floor, back up into the shadow side's edge
  const bounce = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.82, x - r * 0.25, y - r * 0.3, r * 1.32);
  bounce.addColorStop(0, 'rgba(255, 255, 255, 0)');
  bounce.addColorStop(0.7, 'rgba(255, 245, 230, 0.16)');
  bounce.addColorStop(1, 'rgba(255, 245, 230, 0)');
  ctx.fillStyle = bounce;
  ctx.fillRect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);

  // Fresnel: the very edge picks up a little of the room
  ctx.strokeStyle = 'rgba(200, 215, 255, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r - 0.5, 0, TAU);
  ctx.stroke();

  // Softbox reflection: a window of light curving with the surface
  ctx.save();
  ctx.translate(lx + r * 0.02, ly - r * 0.02);
  ctx.rotate(-0.72);
  const box = ctx.createLinearGradient(0, -r * 0.16, 0, r * 0.16);
  box.addColorStop(0, 'rgba(255, 255, 255, 0)');
  box.addColorStop(0.5, 'rgba(255, 255, 255, 0.32)');
  box.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = box;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.36, r * 0.16, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Specular glint
  const glint = ctx.createRadialGradient(lx - r * 0.02, ly - r * 0.02, 0, lx, ly, r * 0.16);
  glint.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  glint.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glint;
  ctx.beginPath();
  ctx.arc(lx, ly, r * 0.16, 0, TAU);
  ctx.fill();

  // A second, small glint from a fill light low on the right
  const fill = ctx.createRadialGradient(x + r * 0.62, y + r * 0.55, 0, x + r * 0.62, y + r * 0.55, r * 0.1);
  fill.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  fill.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x + r * 0.62, y + r * 0.55, r * 0.1, 0, TAU);
  ctx.fill();
  ctx.restore();
}
