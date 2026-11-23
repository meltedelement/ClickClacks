import { TAU } from '../sim/math.js';

// What the Gun's transformations put on the ball, and the SMG's spent
// casings. Drawing only; nothing here changes a fight. Sized from the
// ball's radius so they grow with it.

const BRASS = '#d9b24a';
const BRASS_DARK = '#8a6a14';
const LEATHER = '#6b4325';
const LEATHER_DARK = '#3e2512';

// The point at `angle` on a circle of `radius` round `pos`.
function on({ x, y }, radius, angle) {
  return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
}

// ---- Shotgun ----------------------------------------------------------------------

// A bandolier of red shells slung across the top left of the ball.
export function drawShellBandolier(ctx, { pos, radius: r }) {
  const a = on(pos, r + 3, Math.PI * 1.1);
  const b = on(pos, r + 3, Math.PI * 1.76);
  const along = Math.atan2(b.y - a.y, b.x - a.x);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const s = r / 40;
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r + 4, 0, TAU);
  ctx.clip();
  ctx.translate(a.x, a.y);
  ctx.rotate(along);
  // Strap
  ctx.fillStyle = LEATHER;
  ctx.strokeStyle = LEATHER_DARK;
  ctx.lineWidth = 1.2;
  ctx.fillRect(0, -3.5 * s, length, 7 * s);
  ctx.strokeRect(0, -3.5 * s, length, 7 * s);
  // Shells, standing up out of the loops on the side away from the number
  const shells = 6;
  for (let i = 0; i < shells; i++) {
    const sx = length * (0.17 + (0.66 * i) / (shells - 1));
    ctx.fillStyle = '#c8262c';
    ctx.strokeStyle = '#6e1013';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(sx - 2.2 * s, -9 * s, 4.4 * s, 9 * s, 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BRASS;
    ctx.fillRect(sx - 2.2 * s, -10.5 * s, 4.4 * s, 2.5 * s);
    // Loop holding it
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(sx - 3 * s, -3.5 * s, 6 * s, 3 * s);
  }
  // Stitching
  ctx.strokeStyle = 'rgba(239, 227, 200, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(0, 2 * s);
  ctx.lineTo(length, 2 * s);
  ctx.stroke();
  ctx.restore();
}

// ---- SMG --------------------------------------------------------------------------

// A tactical headset: a band over the top, padded cups at the sides and a
// boom mic curling round to the front.
export function drawHeadset(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  const s = r / 40;
  ctx.save();
  ctx.lineCap = 'round';
  // Band
  ctx.strokeStyle = '#2b2e33';
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = '#4a4f57';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.arc(x, y, r + 2.5, Math.PI * 1.2, Math.PI * 1.45);
  ctx.stroke();
  // Boom mic, from the left cup round to the front
  ctx.strokeStyle = '#2b2e33';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x - r + 1, y + r * 0.05);
  ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.42, x - r * 0.5, y + r * 0.36);
  ctx.stroke();
  ctx.fillStyle = '#1d1f23';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.48, y + r * 0.35, 3.2 * s, 2.4 * s, -0.3, 0, TAU);
  ctx.fill();
  // Cups
  for (const dir of [-1, 1]) {
    const cx = x + dir * (r + 1);
    ctx.fillStyle = '#3a3e45';
    ctx.strokeStyle = '#1d1f23';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 5 * s, y - r * 0.28, 10 * s, r * 0.56, 4 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6fd36f';
    ctx.beginPath();
    ctx.arc(cx, y - r * 0.12, 1.3 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// Spent casings flicked out of the side of the gun, tumbling as they slow.
export function drawCasings(ctx, casings, size) {
  ctx.save();
  for (const { pos, angle, life, maxLife } of casings) {
    ctx.globalAlpha = Math.min(1, (2 * life) / maxLife);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.fillStyle = BRASS;
    ctx.fillRect(-2.2, -1, 4.4, 2);
    ctx.fillStyle = BRASS_DARK;
    ctx.fillRect(-2.2, -1, 1, 2);
    ctx.restore();
  }
  ctx.restore();
}

// ---- Bayonet ----------------------------------------------------------------------

// A dented steel infantry helmet, its chin strap hanging loose.
export function drawInfantryHelmet(ctx, { pos, radius: r }) {
  const { x, y } = pos;
  const rim = y - r * 0.4;
  ctx.save();
  ctx.lineJoin = 'round';
  // Chin straps hanging down the sides
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 2;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + dir * r * 0.86, rim + 1);
    ctx.quadraticCurveTo(x + dir * r * 0.98, y + r * 0.1, x + dir * r * 0.8, y + r * 0.3);
    ctx.stroke();
  }
  // Dome
  const dome = new Path2D();
  dome.moveTo(x - r * 0.9, rim);
  dome.bezierCurveTo(x - r * 0.95, y - r * 1.05, x - r * 0.45, y - r - 7, x, y - r - 7);
  dome.bezierCurveTo(x + r * 0.45, y - r - 7, x + r * 0.95, y - r * 1.05, x + r * 0.9, rim);
  dome.closePath();
  const steel = ctx.createLinearGradient(x - r, y - r, x + r * 0.6, rim);
  steel.addColorStop(0, '#7d8a52');
  steel.addColorStop(1, '#4a5530');
  ctx.fillStyle = steel;
  ctx.fill(dome);
  ctx.strokeStyle = '#2c331b';
  ctx.lineWidth = 1.5;
  ctx.stroke(dome);
  // Dent, catching the light on its lower edge
  ctx.fillStyle = 'rgba(30, 36, 18, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.32, y - r * 0.78, r * 0.13, r * 0.08, -0.4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220, 230, 190, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.32, y - r * 0.78, r * 0.13, r * 0.08, -0.4, 0.2, 2.2);
  ctx.stroke();
  // Shine
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, rim + r * 0.1, r * 0.78, Math.PI * 1.2, Math.PI * 1.38);
  ctx.stroke();
  // Rim, sticking out past the dome
  ctx.fillStyle = '#4a5530';
  ctx.strokeStyle = '#2c331b';
  ctx.beginPath();
  ctx.ellipse(x, rim, r + 4, 3.5, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---- High-Ex and Hotshot ------------------------------------------------------------

const HELMET = '#141417';
const HELMET_EDGE = '#050506';
const GUARD = '#b3221c';
const GUARD_DARK = '#5e0f0b';
const GOLD = '#e0b545';
const GOLD_DARK = '#7a5a12';

// A future cop's helmet: a glossy black dome down to the cheeks, a dark visor
// slot over the eyes under a gold brow plate, and red guards sweeping round
// the cheeks to the jaw, leaving the middle of the ball (its HP) clear. A
// glint runs across the visor now and then.
export function drawRiotHelmet(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  ctx.save();
  ctx.lineJoin = 'round';

  // Dome, down over the sides to the cheeks
  const dome = new Path2D();
  dome.moveTo(x - r - 3, y + r * 0.15);
  dome.bezierCurveTo(x - r - 5, y - r * 0.95, x - r * 0.6, y - r - 6, x, y - r - 6);
  dome.bezierCurveTo(x + r * 0.6, y - r - 6, x + r + 5, y - r * 0.95, x + r + 3, y + r * 0.15);
  dome.lineTo(x + r * 0.62, y - r * 0.2);
  dome.lineTo(x - r * 0.62, y - r * 0.2);
  dome.closePath();
  const shell = ctx.createLinearGradient(x - r * 0.6, y - r, x + r * 0.5, y);
  shell.addColorStop(0, '#45454c');
  shell.addColorStop(0.45, HELMET);
  shell.addColorStop(1, '#09090b');
  ctx.fillStyle = shell;
  ctx.fill(dome);
  ctx.strokeStyle = HELMET_EDGE;
  ctx.lineWidth = 1.5;
  ctx.stroke(dome);
  // Gloss
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - r * 0.15, r * 0.78, Math.PI * 1.22, Math.PI * 1.4);
  ctx.stroke();

  // Visor slot
  const visorTop = y - r * 0.56;
  const visorBottom = y - r * 0.3;
  const visor = new Path2D();
  visor.moveTo(x - r * 0.74, visorTop + r * 0.04);
  visor.quadraticCurveTo(x, visorTop - r * 0.06, x + r * 0.74, visorTop + r * 0.04);
  visor.lineTo(x + r * 0.66, visorBottom);
  visor.quadraticCurveTo(x, visorBottom - r * 0.06, x - r * 0.66, visorBottom);
  visor.closePath();
  const glass = ctx.createLinearGradient(x, visorTop, x, visorBottom);
  glass.addColorStop(0, '#3a2a10');
  glass.addColorStop(1, '#0a0805');
  ctx.fillStyle = glass;
  ctx.fill(visor);
  // Glint sweeping across every couple of seconds
  const sweep = (time * 0.6) % 1;
  if (sweep < 0.35) {
    const gx = x - r * 0.8 + (sweep / 0.35) * r * 1.6;
    ctx.save();
    ctx.clip(visor);
    ctx.fillStyle = 'rgba(255, 228, 150, 0.55)';
    ctx.beginPath();
    ctx.moveTo(gx, visorTop - 2);
    ctx.lineTo(gx + 4, visorTop - 2);
    ctx.lineTo(gx - 2, visorBottom + 2);
    ctx.lineTo(gx - 6, visorBottom + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1.2;
  ctx.stroke(visor);

  // Gold brow plate over the visor, ridged down the middle
  const browTop = y - r * 0.92;
  const plate = new Path2D();
  plate.moveTo(x - r * 0.24, browTop);
  plate.lineTo(x + r * 0.24, browTop);
  plate.lineTo(x + r * 0.36, visorTop + r * 0.01);
  plate.lineTo(x - r * 0.36, visorTop + r * 0.01);
  plate.closePath();
  const gold = ctx.createLinearGradient(x - r * 0.3, browTop, x + r * 0.3, visorTop);
  gold.addColorStop(0, '#fff0b0');
  gold.addColorStop(0.4, GOLD);
  gold.addColorStop(1, '#9c7418');
  ctx.fillStyle = gold;
  ctx.fill(plate);
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1.2;
  ctx.stroke(plate);
  ctx.strokeStyle = 'rgba(90, 64, 10, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of [-0.5, 0, 0.5]) {
    ctx.moveTo(x + t * r * 0.24, browTop + 2);
    ctx.lineTo(x + t * r * 0.34, visorTop - 1);
  }
  ctx.stroke();

  // Red guards, from the back of the dome round the cheeks to the jaw, each
  // with a point reaching up to the end of the visor
  for (const dir of [-1, 1]) {
    const guard = new Path2D();
    guard.moveTo(x + dir * (r + 3.5), y - r * 0.18);
    guard.bezierCurveTo(
      x + dir * (r + 4), y + r * 0.45,
      x + dir * r * 0.8, y + r * 0.82,
      x + dir * r * 0.38, y + r * 0.86,
    );
    guard.lineTo(x + dir * r * 0.42, y + r * 0.6);
    guard.quadraticCurveTo(x + dir * r * 0.6, y + r * 0.3, x + dir * r * 0.6, y - r * 0.1);
    guard.lineTo(x + dir * r * 0.8, y - r * 0.42);
    guard.closePath();
    const red = ctx.createLinearGradient(x + dir * r, y - r * 0.4, x + dir * r * 0.4, y + r * 0.8);
    red.addColorStop(0, '#d8382e');
    red.addColorStop(1, GUARD);
    ctx.fillStyle = red;
    ctx.fill(guard);
    ctx.strokeStyle = GUARD_DARK;
    ctx.lineWidth = 1.4;
    ctx.stroke(guard);
    // A shine along the upper edge, and the notch cut into the cheek
    ctx.strokeStyle = 'rgba(255, 190, 170, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + dir * r * 0.82, y - r * 0.36);
    ctx.lineTo(x + dir * (r + 1), y - r * 0.16);
    ctx.stroke();
    ctx.strokeStyle = GUARD_DARK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + dir * r * 0.9, y + r * 0.12);
    ctx.lineTo(x + dir * r * 0.66, y + r * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Grenadier ----------------------------------------------------------------------

// A belt slung low across the ball with `hooks` hooks, a grenade hanging
// from each of the first `held` (drawn by `drawGrenade(x, y, r)`).
export function drawGrenadeBelt(ctx, { pos, radius: r }, hooks, held, drawGrenade) {
  const { x, y } = pos;
  const s = r / 40;
  const top = y + r * 0.64;
  const height = 5 * s;
  const half = Math.sqrt(r * r - (top + height / 2 - y) ** 2) + 2;
  ctx.save();
  // Belt, with its stitching
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, TAU);
  ctx.clip();
  ctx.fillStyle = LEATHER;
  ctx.fillRect(x - half, top, half * 2, height);
  ctx.strokeStyle = LEATHER_DARK;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x - half, top, half * 2, height);
  ctx.strokeStyle = 'rgba(239, 227, 200, 0.55)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(x - half, top + height / 2);
  ctx.lineTo(x + half, top + height / 2);
  ctx.stroke();
  ctx.restore();

  // Hooks, and the grenades on them
  const g = 4.5 * s;
  for (let i = 0; i < hooks; i++) {
    const hx = x + (i - (hooks - 1) / 2) * r * 0.42;
    const hy = top + height;
    ctx.strokeStyle = '#b9c2cc';
    ctx.lineWidth = 1.6 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, top + 1);
    ctx.lineTo(hx, hy + 2.5 * s);
    ctx.arc(hx + 1.8 * s, hy + 2.5 * s, 1.8 * s, Math.PI, 0, true);
    ctx.stroke();
    if (i < held) drawGrenade(hx, hy + 2.5 * s + g * 1.6, g);
  }
  ctx.restore();
}
