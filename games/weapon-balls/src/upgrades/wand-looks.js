import { TAU } from '../sim/math.js';
import { WILD_COLORS } from '../weapons/Wand.js';

// What the Wand's transformations put on the ball: a hat each, and the
// flames Pyromancer's ring and crown are made of. Drawing only; nothing here
// changes a fight. Sized from the ball's radius so they grow with it, and kept
// above the HP number in the middle (Merlin's beard hangs below it). With
// several transformations every hat is drawn, the last picked on top.

const GOLD = '#ffd84a';
const GOLD_DARK = '#a8781a';

// A five-pointed star of outer radius `r` at (x, y).
function star(ctx, x, y, r, turn = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = turn - Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

// ---- Flames --------------------------------------------------------------------

export const FLAME_OUTER = '#e8361c';
export const FLAME_MID = '#ff8a2a';
export const FLAME_CORE = '#ffe066';

// One tongue of flame from a base at (x, y), `w` wide, licking `h` out along
// `angle` and leaning `lean` (share of h) to its side. Three layers: red, then
// orange, then a yellow heart. `colors` replaces the three (Wild Magic).
export function drawFlame(ctx, x, y, w, h, angle, lean = 0, colors = null) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let layer = 0; layer < 3; layer++) {
    const k = 1 - layer * 0.28; // each layer smaller
    const hw = (w / 2) * k;
    const hh = h * k;
    const tipX = x + cos * hh - sin * lean * hh;
    const tipY = y + sin * hh + cos * lean * hh;
    // Base corners, across the angle, and the belly half-way up.
    const lx = x + sin * hw;
    const ly = y - cos * hw;
    const rx = x - sin * hw;
    const ry = y + cos * hw;
    const bx = x + cos * hh * 0.3;
    const by = y + sin * hh * 0.3;
    ctx.fillStyle = colors ? colors[layer] : layer === 0 ? FLAME_OUTER : layer === 1 ? FLAME_MID : FLAME_CORE;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(bx + sin * hw * 1.1, by - cos * hw * 1.1, tipX, tipY);
    ctx.quadraticCurveTo(bx - sin * hw * 1.1, by + cos * hw * 1.1, rx, ry);
    ctx.arc(x, y, hw, angle + Math.PI / 2, angle - Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }
}

// ---- Merlin --------------------------------------------------------------------

// A tall midnight-blue wizard's hat, its tip flopping over, scattered with
// stars and a moon, and a long white beard hanging below the HP number.
export function drawWizardHat(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  const base = y - r * 0.6;
  ctx.save();
  ctx.lineJoin = 'round';

  // Beard
  const beard = new Path2D();
  beard.moveTo(x - r * 0.62, y + r * 0.36);
  beard.quadraticCurveTo(x - r * 0.62, y + r * 0.9, x - r * 0.18, y + r * 1.05);
  beard.lineTo(x, y + r * 1.3);
  beard.lineTo(x + r * 0.18, y + r * 1.05);
  beard.quadraticCurveTo(x + r * 0.62, y + r * 0.9, x + r * 0.62, y + r * 0.36);
  beard.quadraticCurveTo(x, y + r * 0.5, x - r * 0.62, y + r * 0.36);
  ctx.fillStyle = '#f4f2ec';
  ctx.fill(beard);
  ctx.strokeStyle = '#b9b4a8';
  ctx.lineWidth = 1.2;
  ctx.stroke(beard);
  ctx.strokeStyle = 'rgba(150, 145, 135, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const k of [-0.3, 0, 0.3]) {
    ctx.moveTo(x + k * r, y + r * 0.55);
    ctx.quadraticCurveTo(x + k * r * 1.1, y + r * 0.8, x + k * r * 0.5, y + r * 1.02);
  }
  ctx.stroke();

  // Brim
  ctx.fillStyle = '#25317a';
  ctx.strokeStyle = '#121a4a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, base, r * 0.98, r * 0.2, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Cone, flopping over to the right
  const tipX = x + r * 0.62;
  const tipY = y - r * 1.62;
  const cone = new Path2D();
  cone.moveTo(x - r * 0.58, base);
  cone.quadraticCurveTo(x - r * 0.38, y - r * 1.45, x + r * 0.05, y - r * 1.85);
  cone.quadraticCurveTo(x + r * 0.4, y - r * 2.0, tipX, tipY);
  cone.quadraticCurveTo(x + r * 0.28, y - r * 1.68, x + r * 0.16, y - r * 1.5);
  cone.quadraticCurveTo(x + r * 0.42, y - r * 1.0, x + r * 0.58, base);
  cone.quadraticCurveTo(x, base + r * 0.1, x - r * 0.58, base);
  const cloth = ctx.createLinearGradient(x - r * 0.5, y - r * 1.6, x + r * 0.5, base);
  cloth.addColorStop(0, '#4d63e0');
  cloth.addColorStop(1, '#1f2a7a');
  ctx.fillStyle = cloth;
  ctx.fill(cone);
  ctx.strokeStyle = '#121a4a';
  ctx.stroke(cone);

  // Gold band round the bottom
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3.5 * s;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, base - r * 0.1);
  ctx.quadraticCurveTo(x, base - r * 0.01, x + r * 0.55, base - r * 0.1);
  ctx.stroke();

  // Moon and stars
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y - r * 1.05, r * 0.14, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#34459f';
  ctx.beginPath();
  ctx.arc(x - r * 0.06, y - r * 1.09, r * 0.12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = GOLD;
  star(ctx, x + r * 0.22, y - r * 0.88, r * 0.09);
  ctx.fill();
  star(ctx, x + r * 0.02, y - r * 1.42, r * 0.07, 0.4);
  ctx.fill();

  // A twinkling star on the tip
  const twinkle = 0.8 + 0.3 * Math.sin(time * 6);
  ctx.fillStyle = 'rgba(255, 236, 140, 0.4)';
  ctx.beginPath();
  ctx.arc(tipX, tipY, r * 0.16 * twinkle, 0, TAU);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1;
  star(ctx, tipX, tipY, r * 0.12 * twinkle, time);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---- Evoker --------------------------------------------------------------------

// A deep violet cowl with a peak, trimmed in gold, a glowing gem at the brow
// and two little sparks of orb circling it.
export function drawCowl(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  ctx.save();
  ctx.lineJoin = 'round';
  const hood = new Path2D();
  hood.moveTo(x - r - 3, y + r * 0.35);
  hood.bezierCurveTo(x - r - 6, y - r * 0.8, x - r * 0.5, y - r - 6, x + r * 0.1, y - r - 14 * s);
  hood.bezierCurveTo(x + r * 0.55, y - r - 4, x + r + 6, y - r * 0.8, x + r + 3, y + r * 0.35);
  hood.lineTo(x + r * 0.74, y + r * 0.35);
  hood.bezierCurveTo(x + r * 0.78, y - r * 0.3, x + r * 0.4, y - r * 0.6, x, y - r * 0.6);
  hood.bezierCurveTo(x - r * 0.4, y - r * 0.6, x - r * 0.78, y - r * 0.3, x - r * 0.74, y + r * 0.35);
  hood.closePath();
  const cloth = ctx.createLinearGradient(x - r, y - r, x + r, y + r * 0.3);
  cloth.addColorStop(0, '#6b3fa0');
  cloth.addColorStop(1, '#2a1442');
  ctx.fillStyle = cloth;
  ctx.fill(hood);
  ctx.strokeStyle = '#170a26';
  ctx.lineWidth = 1.5;
  ctx.stroke(hood);
  // Folds
  ctx.strokeStyle = 'rgba(20, 8, 36, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const dir of [-1, 1]) {
    ctx.moveTo(x + dir * r * 0.9, y + r * 0.3);
    ctx.quadraticCurveTo(x + dir * r * 0.95, y - r * 0.4, x + dir * r * 0.55, y - r * 0.85);
  }
  ctx.stroke();
  // Gold trim round the face
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.74, y + r * 0.35);
  ctx.bezierCurveTo(x + r * 0.78, y - r * 0.3, x + r * 0.4, y - r * 0.6, x, y - r * 0.6);
  ctx.bezierCurveTo(x - r * 0.4, y - r * 0.6, x - r * 0.78, y - r * 0.3, x - r * 0.74, y + r * 0.35);
  ctx.stroke();

  // Gem at the brow, and its two sparks
  const gx = x;
  const gy = y - r * 0.78;
  const pulse = 0.85 + 0.15 * Math.sin(time * 4);
  ctx.fillStyle = 'rgba(255, 158, 232, 0.35)';
  ctx.beginPath();
  ctx.arc(gx, gy, r * 0.2 * pulse, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ff9ee8';
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(gx, gy - r * 0.12);
  ctx.lineTo(gx + r * 0.08, gy);
  ctx.lineTo(gx, gy + r * 0.12);
  ctx.lineTo(gx - r * 0.08, gy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k < 2; k++) {
    const a = time * 3 + k * Math.PI;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gx + Math.cos(a) * r * 0.24, gy + Math.sin(a) * r * 0.1, 1.6 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Pyromancer ----------------------------------------------------------------

// A gold circlet with a ruby, crowned by flickering flames.
export function drawFlameCrown(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  const band = y - r * 0.62;
  ctx.save();
  // Flames, tallest in the middle
  const flames = 5;
  for (let i = 0; i < flames; i++) {
    const k = (i - (flames - 1) / 2) / ((flames - 1) / 2); // -1..1
    const fx = x + k * r * 0.5;
    const fy = band - r * 0.08 - (1 - k * k) * r * 0.08;
    const h = r * (0.55 + 0.35 * (1 - Math.abs(k))) * (0.85 + 0.15 * Math.sin(time * 11 + i * 2.3));
    const lean = 0.12 * Math.sin(time * 5 + i * 1.7) + k * 0.15;
    drawFlame(ctx, fx, fy, r * 0.26, h, -Math.PI / 2, lean);
  }
  // Circlet
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 6 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.66, band + r * 0.06);
  ctx.quadraticCurveTo(x, band - r * 0.14, x + r * 0.66, band + r * 0.06);
  ctx.stroke();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4 * s;
  ctx.stroke();
  ctx.fillStyle = '#d8202a';
  ctx.strokeStyle = '#6e0d12';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, band - r * 0.04, r * 0.09, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(x - r * 0.03, band - r * 0.07, r * 0.03, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- Aeromancer ----------------------------------------------------------------

// A silver circlet with a sky-blue gem and a white wing on each side,
// flapping gently.
export function drawWingedCirclet(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  const band = y - r * 0.62;
  ctx.save();
  ctx.lineJoin = 'round';
  const flap = 0.12 * Math.sin(time * 5);
  for (const dir of [-1, 1]) {
    const wx = x + dir * r * 0.66;
    const wy = band + r * 0.02;
    // Feathers, fanned up and out, longest at the top
    for (let f = 0; f < 4; f++) {
      const a = -Math.PI / 2 + dir * (0.5 + f * 0.32 + flap);
      const len = r * (0.75 - f * 0.12);
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(a);
      ctx.fillStyle = f % 2 === 0 ? '#ffffff' : '#e3f1fb';
      ctx.strokeStyle = '#8fb3c9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(len / 2, 0, len / 2, r * 0.1, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  // Band and gem
  ctx.strokeStyle = '#6f8494';
  ctx.lineWidth = 5.5 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.68, band + r * 0.06);
  ctx.quadraticCurveTo(x, band - r * 0.14, x + r * 0.68, band + r * 0.06);
  ctx.stroke();
  ctx.strokeStyle = '#dfe8ef';
  ctx.lineWidth = 3.5 * s;
  ctx.stroke();
  ctx.fillStyle = '#7fd3ff';
  ctx.strokeStyle = '#3a7da8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, band - r * 0.04, r * 0.1, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // A curl of wind in the gem
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, band - r * 0.04, r * 0.05, time * 4, time * 4 + 4);
  ctx.stroke();
  ctx.restore();
}

// ---- Hydromancer ---------------------------------------------------------------

// A cresting wave worn as a hat, curling over to the left with a fringe of
// foam, bobbing a little.
export function drawWaveHat(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const bob = Math.sin(time * 3) * r * 0.03;
  const base = y - r * 0.58;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.translate(0, bob);
  const wave = new Path2D();
  wave.moveTo(x - r * 0.8, base);
  wave.quadraticCurveTo(x, base - r * 0.22, x + r * 0.8, base);
  wave.bezierCurveTo(x + r * 0.85, y - r * 1.2, x + r * 0.5, y - r * 1.75, x - r * 0.05, y - r * 1.72);
  wave.bezierCurveTo(x - r * 0.5, y - r * 1.7, x - r * 0.62, y - r * 1.38, x - r * 0.4, y - r * 1.2);
  wave.bezierCurveTo(x - r * 0.25, y - r * 1.1, x - r * 0.08, y - r * 1.28, x - r * 0.2, y - r * 1.36);
  wave.bezierCurveTo(x - r * 0.1, y - r * 1.2, x - r * 0.5, y - r * 0.95, x - r * 0.8, base);
  const water = ctx.createLinearGradient(x, y - r * 1.7, x, base);
  water.addColorStop(0, '#7fd3ff');
  water.addColorStop(0.5, '#2f8fd6');
  water.addColorStop(1, '#155a9e');
  ctx.fillStyle = water;
  ctx.fill(wave);
  ctx.strokeStyle = '#0d3f73';
  ctx.lineWidth = 1.5;
  ctx.stroke(wave);
  // Streaks down its face
  ctx.strokeStyle = 'rgba(200, 236, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + r * 0.5, y - r * 1.3);
  ctx.quadraticCurveTo(x + r * 0.6, y - r * 0.95, x + r * 0.45, y - r * 0.72);
  ctx.moveTo(x + r * 0.15, y - r * 1.2);
  ctx.quadraticCurveTo(x + r * 0.25, y - r * 0.9, x + r * 0.1, y - r * 0.72);
  ctx.stroke();
  // Foam along the crest
  ctx.fillStyle = '#ffffff';
  const foam = [
    [0.62, -1.42, 0.09],
    [0.42, -1.62, 0.1],
    [0.15, -1.72, 0.1],
    [-0.15, -1.72, 0.09],
    [-0.42, -1.6, 0.08],
    [-0.52, -1.38, 0.07],
  ];
  for (const [fx, fy, fr] of foam) {
    ctx.beginPath();
    ctx.arc(x + fx * r, y + fy * r, fr * r, 0, TAU);
    ctx.fill();
  }
  // A drop flicked off the curl
  const drip = (time * 0.8) % 1;
  ctx.globalAlpha = 1 - drip;
  ctx.fillStyle = '#9fe0ff';
  ctx.beginPath();
  ctx.arc(x - r * 0.7, y - r * 1.25 + drip * r * 0.4, r * 0.05, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- Geomancer -----------------------------------------------------------------

const STONE_POINTS = [
  [-0.95, -0.5],
  [-0.92, -0.82],
  [-0.66, -1.08],
  [-0.3, -1.12],
  [0.04, -1.2],
  [0.38, -1.1],
  [0.7, -1.04],
  [0.94, -0.78],
  [0.96, -0.5],
];

// A rough stone helm with moss on it and crystals growing out of the top.
export function drawStoneHelm(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  ctx.save();
  ctx.lineJoin = 'round';

  // Crystals, behind the helm so it covers their roots
  const crystals = [
    [-0.3, -1.0, -0.35, 0.55, '#b58cff'],
    [0.08, -1.08, 0.08, 0.72, '#9b6cf0'],
    [0.42, -0.98, 0.45, 0.48, '#c9a6ff'],
  ];
  for (const [cx, cy, tilt, len, color] of crystals) {
    ctx.save();
    ctx.translate(x + cx * r, y + cy * r);
    ctx.rotate(tilt);
    const w = r * 0.12;
    const h = r * len;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#4a2a80';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(-w, -h * 0.75);
    ctx.lineTo(0, -h);
    ctx.lineTo(w, -h * 0.75);
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -h * 0.1);
    ctx.lineTo(-w * 0.5, -h * 0.72);
    ctx.lineTo(0, -h * 0.9);
    ctx.lineTo(0, -h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // The helm: a jagged dome down to the brow
  const helm = new Path2D();
  helm.moveTo(x + STONE_POINTS[0][0] * r, y + STONE_POINTS[0][1] * r);
  for (let i = 1; i < STONE_POINTS.length; i++) helm.lineTo(x + STONE_POINTS[i][0] * r, y + STONE_POINTS[i][1] * r);
  helm.lineTo(x + r * 0.7, y - r * 0.5);
  helm.lineTo(x + r * 0.35, y - r * 0.6);
  helm.lineTo(x, y - r * 0.55);
  helm.lineTo(x - r * 0.38, y - r * 0.62);
  helm.lineTo(x - r * 0.7, y - r * 0.5);
  helm.closePath();
  const rock = ctx.createLinearGradient(x - r, y - r * 1.1, x + r * 0.6, y - r * 0.5);
  rock.addColorStop(0, '#9a8a76');
  rock.addColorStop(1, '#5a4a3a');
  ctx.fillStyle = rock;
  ctx.fill(helm);
  ctx.strokeStyle = '#2e2219';
  ctx.lineWidth = 1.5;
  ctx.stroke(helm);
  // Cracks
  ctx.strokeStyle = 'rgba(40, 28, 18, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y - r * 0.95);
  ctx.lineTo(x - r * 0.42, y - r * 0.78);
  ctx.lineTo(x - r * 0.5, y - r * 0.64);
  ctx.moveTo(x + r * 0.6, y - r * 0.9);
  ctx.lineTo(x + r * 0.5, y - r * 0.72);
  ctx.stroke();
  // Moss
  ctx.fillStyle = '#5f9a3a';
  for (const [mx, my, mr] of [
    [-0.75, -0.85, 0.12],
    [-0.62, -0.92, 0.09],
    [0.78, -0.62, 0.1],
    [0.2, -0.62, 0.08],
  ]) {
    ctx.beginPath();
    ctx.arc(x + mx * r, y + my * r, mr * r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Wild Magic ----------------------------------------------------------------

// A jester's hat with three floppy points in shifting colours, a bell on each.
export function drawJesterHat(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  const band = y - r * 0.6;
  const shift = Math.floor(time * 2);
  ctx.save();
  ctx.lineJoin = 'round';
  // Each point: its base corners, the tip, and a control point for each edge.
  const points = [
    { a: [-0.76, -0.58], b: [-0.12, -0.74], tip: [-1.2, -0.92], ca: [-1.0, -1.4], cb: [-0.6, -1.15] },
    { a: [0.76, -0.58], b: [0.12, -0.74], tip: [1.2, -0.92], ca: [1.0, -1.4], cb: [0.6, -1.15] },
    { a: [-0.32, -0.72], b: [0.32, -0.72], tip: [0.12, -1.78], ca: [-0.35, -1.45], cb: [0.35, -1.25] },
  ];
  points.forEach(({ a, b, tip, ca, cb }, i) => {
    const sway = Math.sin(time * 4 + i * 2) * r * 0.06;
    const tx = x + tip[0] * r + sway;
    const ty = y + tip[1] * r;
    ctx.fillStyle = WILD_COLORS[(i + shift) % WILD_COLORS.length];
    ctx.strokeStyle = '#3a2350';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + a[0] * r, y + a[1] * r);
    ctx.quadraticCurveTo(x + ca[0] * r, y + ca[1] * r, tx, ty);
    ctx.quadraticCurveTo(x + cb[0] * r, y + cb[1] * r, x + b[0] * r, y + b[1] * r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Bell
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.1, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5a3a0a';
    ctx.beginPath();
    ctx.arc(tx, ty + r * 0.03, r * 0.025, 0, TAU);
    ctx.fill();
  });
  // Band of diamonds
  ctx.fillStyle = '#3a2350';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.78, band + r * 0.08);
  ctx.quadraticCurveTo(x, band - r * 0.14, x + r * 0.78, band + r * 0.08);
  ctx.lineTo(x + r * 0.76, band - r * 0.06);
  ctx.quadraticCurveTo(x, band - r * 0.3, x - r * 0.76, band - r * 0.06);
  ctx.closePath();
  ctx.fill();
  for (let k = 0; k < 5; k++) {
    const t = (k - 2) / 2.6;
    const dx = x + t * r * 0.75;
    const dy = band - r * 0.03 - (1 - t * t) * r * 0.1;
    ctx.fillStyle = WILD_COLORS[(k + shift + 1) % WILD_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(dx, dy - 3.5 * s);
    ctx.lineTo(dx + 3 * s, dy);
    ctx.lineTo(dx, dy + 3.5 * s);
    ctx.lineTo(dx - 3 * s, dy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---- Artificer -----------------------------------------------------------------

// A short brown top hat with a brass band, a turning gear on the side and
// brass goggles with amber lenses pushed up onto the brim.
export function drawTinkerHat(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  const s = r / 40;
  const brim = y - r * 0.68;
  ctx.save();
  ctx.lineJoin = 'round';
  // Crown
  ctx.fillStyle = '#5b3a22';
  ctx.strokeStyle = '#2a170a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.48, brim);
  ctx.lineTo(x - r * 0.54, y - r * 1.48);
  ctx.quadraticCurveTo(x, y - r * 1.58, x + r * 0.54, y - r * 1.48);
  ctx.lineTo(x + r * 0.48, brim);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7a5232';
  ctx.beginPath();
  ctx.ellipse(x, y - r * 1.5, r * 0.54, r * 0.08, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // Brass band
  ctx.fillStyle = '#c9963a';
  ctx.fillRect(x - r * 0.5, brim - r * 0.3, r, r * 0.13);
  // Brim
  ctx.fillStyle = '#4a2e1a';
  ctx.beginPath();
  ctx.ellipse(x, brim, r * 0.85, r * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // Gear on the side
  const gx = x + r * 0.42;
  const gy = y - r * 1.02;
  const teeth = 8;
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(time * 1.5);
  ctx.fillStyle = '#d9b24a';
  ctx.strokeStyle = '#8a6a14';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i * Math.PI) / teeth;
    const d = i % 2 === 0 ? r * 0.2 : r * 0.15;
    ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5b3a22';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.06, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Goggles on the brim
  for (const dir of [-1, 1]) {
    const lx = x + dir * r * 0.24;
    const ly = brim - r * 0.06;
    ctx.fillStyle = '#b8862e';
    ctx.strokeStyle = '#6a4a0e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(lx, ly, r * 0.17, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb36b';
    ctx.beginPath();
    ctx.arc(lx, ly, r * 0.11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(lx - r * 0.04, ly - r * 0.04, r * 0.035, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = '#6a4a0e';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.07, brim - r * 0.06);
  ctx.lineTo(x + r * 0.07, brim - r * 0.06);
  ctx.stroke();
  ctx.restore();
}
