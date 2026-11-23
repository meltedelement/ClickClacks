import { TAU } from '../sim/math.js';

// How a ball can be drawn instead of a plain disc (a fighter's `skin`). Drawing
// only: the sim never sees any of it. Each skin has:
//   label  the colour of the name (and tag) above the ball
//   hp     the HP number's colour, plain and while the ball flashes from a hit,
//          where white wouldn't read on it (optional)
//   draw   (ctx, ball, t) draws the ball, t in seconds
// The Renderer draws a flashing ball the plain way, so a hit still shows.
export const SKINS = {
  // The dev orb: polished gold with a highlight, a glint that sweeps across it
  // and a few sparkles that twinkle around it.
  gold: { label: '#ffd23f', hp: ['#3d2b00', '#b8860b'], draw: drawGold },
  // The ball's own colour with sprinkles, a party hat and confetti around it.
  birthday: { label: '#ff8fd8', draw: drawBirthday },
  // Every colour, turning.
  rainbow: { label: '#ffffff', hp: ['#111111', '#111111'], draw: drawRainbow },
  // Deep space with stars twinkling inside.
  galaxy: { label: '#c9a7ff', draw: drawGalaxy },
  // Pale ice-blue facets with a cold sparkle.
  diamond: { label: '#a8f0ff', hp: ['#0b3a4a', '#0b3a4a'], draw: drawDiamond },
  // A hot core with flames licking off it.
  fire: { label: '#ffb347', hp: ['#4a1000', '#4a1000'], draw: drawFire },
};

export const SKIN_IDS = Object.keys(SKINS);

const GOLD_SWEEP_SECONDS = 2.4;
const CONFETTI = ['#ff5c8a', '#ffd23f', '#5ce1ff', '#7cff6b', '#c58bff'];

function disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function rim(ctx, ball, color) {
  disc(ctx, ball.pos.x, ball.pos.y, ball.radius);
  ctx.lineWidth = 3 * ball.size;
  ctx.strokeStyle = color;
  ctx.stroke();
}

// A soft white highlight up and to the left, so a ball looks round.
function shine(ctx, x, y, r, alpha = 0.45) {
  const light = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, 0, x - r * 0.4, y - r * 0.45, r * 0.7);
  light.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
  light.addColorStop(1, 'rgba(255, 255, 255, 0)');
  disc(ctx, x, y, r);
  ctx.fillStyle = light;
  ctx.fill();
}

// Four-pointed stars circling just outside the rim, twinkling in turn.
function sparkles(ctx, x, y, r, t, count, color, distance = 1.18) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const angle = t * 0.8 + (i * TAU) / count;
    const twinkle = Math.max(0, Math.sin(t * 3 + i * 2.1));
    if (twinkle < 0.05) continue;
    star(ctx, x + Math.cos(angle) * r * distance, y + Math.sin(angle) * r * distance, r * 0.22 * twinkle);
  }
}

function star(ctx, sx, sy, size) {
  ctx.beginPath();
  ctx.moveTo(sx, sy - size);
  ctx.quadraticCurveTo(sx, sy, sx + size, sy);
  ctx.quadraticCurveTo(sx, sy, sx, sy + size);
  ctx.quadraticCurveTo(sx, sy, sx - size, sy);
  ctx.quadraticCurveTo(sx, sy, sx, sy - size);
  ctx.fill();
}

function drawGold(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  body.addColorStop(0, '#fffbe0');
  body.addColorStop(0.3, '#ffd94a');
  body.addColorStop(0.7, '#d9a21b');
  body.addColorStop(1, '#8a6106');
  disc(ctx, x, y, r);
  ctx.fillStyle = body;
  ctx.fill();

  // A band of light crossing the ball every couple of seconds.
  const sweep = ((t % GOLD_SWEEP_SECONDS) / GOLD_SWEEP_SECONDS) * 3 - 1.5; // -1.5..1.5 radii, mostly off the ball
  ctx.save();
  ctx.clip();
  ctx.translate(x + sweep * r, y);
  ctx.rotate(-0.6);
  const band = ctx.createLinearGradient(-r * 0.3, 0, r * 0.3, 0);
  band.addColorStop(0, 'rgba(255, 255, 255, 0)');
  band.addColorStop(0.5, 'rgba(255, 255, 255, 0.75)');
  band.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = band;
  ctx.fillRect(-r * 0.3, -r * 2, r * 0.6, r * 4);
  ctx.restore();

  rim(ctx, ball, '#6b4a00');
  sparkles(ctx, x, y, r, t, 4, '#fff3b0');
}

function drawBirthday(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;

  // Confetti drifting round the ball, each piece tumbling.
  for (let i = 0; i < 10; i++) {
    const angle = t * 0.5 + (i * TAU) / 10;
    const distance = r * (1.25 + 0.12 * Math.sin(t * 2 + i));
    ctx.save();
    ctx.translate(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
    ctx.rotate(t * 4 + i);
    ctx.scale(1, Math.abs(Math.cos(t * 3 + i * 1.7)) * 0.8 + 0.2); // flipping over
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    ctx.fillRect(-r * 0.09, -r * 0.05, r * 0.18, r * 0.1);
    ctx.restore();
  }

  disc(ctx, x, y, r);
  ctx.fillStyle = ball.color;
  ctx.fill();

  // Sprinkles: little bars at fixed spots on the ball (a golden-angle spiral).
  ctx.save();
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.07;
  for (let i = 0; i < 14; i++) {
    const along = Math.sqrt((i + 0.5) / 14) * r * 0.85;
    const angle = i * 2.39996;
    const sx = x + Math.cos(angle) * along;
    const sy = y + Math.sin(angle) * along;
    const turn = i * 1.3;
    ctx.strokeStyle = CONFETTI[i % CONFETTI.length];
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(turn) * r * 0.07, sy - Math.sin(turn) * r * 0.07);
    ctx.lineTo(sx + Math.cos(turn) * r * 0.07, sy + Math.sin(turn) * r * 0.07);
    ctx.stroke();
  }
  ctx.restore();
  shine(ctx, x, y, r, 0.3);
  rim(ctx, ball, 'rgba(0, 0, 0, 0.35)');

  // A party hat, tilted and bobbing a little.
  ctx.save();
  ctx.translate(x + r * 0.35, y - r * 0.8);
  ctx.rotate(0.45 + Math.sin(t * 2.5) * 0.06);
  const w = r * 0.45;
  const hatHeight = r * 0.85;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(0, -hatHeight);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fillStyle = '#ff5c8a';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ffd23f';
  for (let i = 1; i <= 3; i++) ctx.fillRect(-w, -hatHeight * (i / 4) - r * 0.05, w * 2, r * 0.1);
  ctx.restore();
  ctx.lineWidth = 2 * ball.size;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  disc(ctx, 0, -hatHeight, r * 0.12);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

function drawRainbow(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;
  const body = ctx.createConicGradient(t * 1.5, x, y);
  for (let i = 0; i <= 6; i++) body.addColorStop(i / 6, `hsl(${i * 60}, 90%, 62%)`);
  disc(ctx, x, y, r);
  ctx.fillStyle = body;
  ctx.fill();
  // Paler towards the middle, so the number sits on something calm.
  const middle = ctx.createRadialGradient(x, y, 0, x, y, r);
  middle.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  middle.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
  middle.addColorStop(1, 'rgba(255, 255, 255, 0)');
  disc(ctx, x, y, r);
  ctx.fillStyle = middle;
  ctx.fill();
  rim(ctx, ball, `hsl(${(t * 90) % 360}, 90%, 35%)`);
}

function drawGalaxy(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;
  const body = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
  body.addColorStop(0, '#5b2a9e');
  body.addColorStop(0.55, '#24135a');
  body.addColorStop(1, '#0a0820');
  disc(ctx, x, y, r);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // A nebula: two soft clouds slowly turning.
  for (let i = 0; i < 2; i++) {
    const angle = t * 0.3 + i * Math.PI;
    const cx = x + Math.cos(angle) * r * 0.35;
    const cy = y + Math.sin(angle) * r * 0.35;
    const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.6);
    cloud.addColorStop(0, i === 0 ? 'rgba(255, 92, 200, 0.35)' : 'rgba(92, 200, 255, 0.3)');
    cloud.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Stars at fixed spots, each twinkling on its own beat.
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 16; i++) {
    const along = Math.sqrt((i + 0.5) / 16) * r * 0.92;
    const angle = i * 2.39996 + t * 0.15;
    const twinkle = 0.5 + 0.5 * Math.sin(t * (2 + (i % 5) * 0.6) + i * 1.9);
    ctx.globalAlpha = 0.35 + twinkle * 0.65;
    disc(ctx, x + Math.cos(angle) * along, y + Math.sin(angle) * along, r * (0.025 + 0.03 * twinkle));
    ctx.fill();
  }
  ctx.restore();
  rim(ctx, ball, '#8b6cff');
}

function drawDiamond(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;
  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.4, '#c8f6ff');
  body.addColorStop(0.8, '#7fd8f0');
  body.addColorStop(1, '#4aa8c8');
  disc(ctx, x, y, r);
  ctx.fillStyle = body;
  ctx.fill();

  // Facets: an inner hexagon joined to the rim, catching the light in turn.
  ctx.save();
  ctx.clip();
  const inner = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * TAU) / 6 + Math.PI / 6;
    inner.push([x + Math.cos(angle) * r * 0.5, y + Math.sin(angle) * r * 0.5, angle]);
  }
  for (let i = 0; i < 6; i++) {
    const [ax, ay, angle] = inner[i];
    const [bx, by, next] = inner[(i + 1) % 6];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(x + Math.cos(angle) * r * 1.1, y + Math.sin(angle) * r * 1.1);
    ctx.lineTo(x + Math.cos(next) * r * 1.1, y + Math.sin(next) * r * 1.1);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * Math.max(0, Math.sin(t * 2 - i))})`;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5 * ball.size;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [ax, ay, angle] = inner[i];
    ctx.moveTo(ax, ay);
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  for (let i = 0; i <= 6; i++) ctx[i === 0 ? 'moveTo' : 'lineTo'](...inner[i % 6]);
  ctx.stroke();
  ctx.restore();

  rim(ctx, ball, '#2f7f9c');
  sparkles(ctx, x, y, r, t * 1.2, 3, '#e8fbff');
}

function drawFire(ctx, ball, t) {
  const { x, y } = ball.pos;
  const r = ball.radius;

  // Flames: tongues round the rim, flickering, leaning up.
  for (let i = 0; i < 12; i++) {
    const angle = (i * TAU) / 12 + Math.sin(t * 1.3 + i) * 0.08;
    const flicker = 0.75 + 0.25 * Math.sin(t * 9 + i * 2.7) + 0.15 * Math.sin(t * 14 + i * 1.1);
    const up = 0.6 + 0.4 * Math.max(0, -Math.sin(angle)); // taller on top
    const reach = r * (1.05 + 0.55 * flicker * up);
    const tip = angle - 0.25 * Math.cos(angle); // bent upwards
    const side = TAU / 24;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle - side) * r * 0.9, y + Math.sin(angle - side) * r * 0.9);
    ctx.quadraticCurveTo(x + Math.cos(angle) * r * 1.1, y + Math.sin(angle) * r * 1.1, x + Math.cos(tip) * reach, y + Math.sin(tip) * reach - r * 0.08 * flicker);
    ctx.quadraticCurveTo(x + Math.cos(angle) * r * 1.1, y + Math.sin(angle) * r * 1.1, x + Math.cos(angle + side) * r * 0.9, y + Math.sin(angle + side) * r * 0.9);
    ctx.fillStyle = i % 2 === 0 ? '#ff6a1a' : '#ffb000';
    ctx.fill();
  }

  const pulse = 0.05 * Math.sin(t * 6);
  const body = ctx.createRadialGradient(x, y + r * 0.1, 0, x, y, r);
  body.addColorStop(0, '#fff6c8');
  body.addColorStop(0.35 + pulse, '#ffd23f');
  body.addColorStop(0.75, '#ff7a1a');
  body.addColorStop(1, '#c2290a');
  disc(ctx, x, y, r);
  ctx.fillStyle = body;
  ctx.fill();
  rim(ctx, ball, '#7a1500');
}
