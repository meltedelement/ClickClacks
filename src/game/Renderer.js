import { CONFIG } from '../config.js';
import { TAU } from '../sim/math.js';
import { drawText } from './TextSprites.js';

const GRID_SPACING = 50;
const LABEL_SIZE = 18;
// 2x is plenty for this flat-shaded art, and it keeps the backing store (and so
// the fill rate) sane on 3x screens. The quality levels scale below this.
const MAX_PIXEL_RATIO = 2;
const FONT = 'system-ui, sans-serif';
// Text styles for TextSprites.drawText; `fill`/`baseline` are set per draw where they vary.
const HP_STYLE = { weight: 'bold', size: 20, family: FONT, fill: '#ffffff', baseline: 'middle' };
const LABEL_STYLE = { weight: 'bold', size: LABEL_SIZE, family: FONT, fill: '#ffffff', stroke: 'rgba(0, 0, 0, 0.6)', strokeWidth: 4, baseline: 'bottom' };
const COUNT_STYLE = { weight: 'bold', size: 20, family: FONT, fill: 'rgba(255, 255, 255, 0.85)', stroke: 'rgba(0, 0, 0, 0.6)', strokeWidth: 4, baseline: 'top' };
const COLORS = {
  background: '#171a21',
  grid: 'rgba(255, 255, 255, 0.04)',
  border: '#3a4150',
  overlay: 'rgba(10, 12, 16, 0.7)',
  suddenDeath: '255, 77, 77', // rgb, faded in and out
};

// Draws a Simulation plus effects onto a canvas. Everything is drawn in arena
// units; the canvas backing store tracks its on-screen size so it stays sharp
// however big the arena is displayed. A royale's arena is bigger than the
// normal one: it's zoomed out to fit, while the banners, border and grid are
// drawn in "screen units" (the normal arena's), so they look the same.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // Opaque: the arena is painted edge to edge every frame, so the browser
    // can skip blending the canvas with the page behind it.
    this.ctx = canvas.getContext('2d', { alpha: false });
    // Multiplied into the device pixel ratio: the quality controller lowers it
    // when frames are being dropped. Everything is drawn in arena units, so
    // this only changes how many device pixels it lands on.
    this.resolutionScale = 1;
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  // Stops watching the canvas, for an arena that's being removed.
  destroy() {
    this.resizeObserver.disconnect();
  }

  // Called by the quality controller. Cheap when the scale doesn't change.
  setResolutionScale(scale) {
    if (scale === this.resolutionScale) return;
    this.resolutionScale = scale;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.resolutionScale;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    // Assigning canvas size wipes it, so only do it when the size really changed.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  // With no sim (nothing to play yet) this draws an empty arena.
  draw(sim, effects, { showHitboxes = false, paused = false, endHint = '' } = {}) {
    const { ctx } = this;
    const { width, height } = sim?.arena ?? CONFIG.arena;
    // Device pixels per arena unit, and arena units per screen unit (1 unless it's a royale).
    this.scale = this.canvas.width / width;
    const zoom = width / CONFIG.arena.width;

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    const shake = effects.shakeOffset();
    ctx.translate(shake.x, shake.y);

    this.drawGrid(width, height, GRID_SPACING * zoom);
    const balls = sim?.aliveBalls ?? [];
    for (const ball of balls) {
      ball.weapon.ability?.draw(ctx);
      for (const upgrade of ball.weapon.upgrades) upgrade.drawUnder(ctx);
    }
    for (const ball of balls) {
      ball.draw(ctx);
      HP_STYLE.fill = ball.hpTextColor;
      this.drawHp(ball);
    }
    for (const ball of balls) for (const status of ball.statuses) status.draw(ctx);
    for (const ball of balls) ball.weapon.draw(ctx);
    for (const ball of balls) {
      ball.weapon.ability?.drawOver(ctx);
      for (const upgrade of ball.weapon.upgrades) upgrade.drawOver(ctx);
    }
    for (const ball of balls) if (ball.label) this.drawLabel(ball);
    if (showHitboxes) this.drawHitboxes(balls);
    effects.draw(ctx, this.scale);

    ctx.restore();

    // The rest is in screen units: the normal arena's size, whatever this one's is.
    const screen = this.scale * zoom;
    ctx.setTransform(screen, 0, 0, screen, 0, 0);
    const w = width / zoom;
    const h = height / zoom;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    if (sim?.inSuddenDeath && !sim.over) this.drawSuddenDeath(sim, w, h);
    if (sim?.royale && !sim.over) this.drawRemaining(sim, screen);

    if (!sim) this.drawBanner(w, h, 'WAITING FOR MATCH', '#ffffff', '');
    else if (sim.over) this.drawBanner(w, h, winnerText(sim), sim.winner?.color, endHint);
    else if (paused) this.drawBanner(w, h, 'PAUSED', '#ffffff', 'Space to resume');
  }

  drawGrid(width, height, spacing) {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = spacing / GRID_SPACING;
    ctx.beginPath();
    for (let x = spacing; x < width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = spacing; y < height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  // The HP number, scaled with the ball (royale balls grow). The sprite's
  // resolution follows the size in steps, so growing balls share sprites.
  drawHp(ball) {
    const { x, y } = ball.pos;
    const size = ball.size;
    if (size === 1) {
      drawText(this.ctx, ball.hpText, x, y + 1, HP_STYLE, this.scale);
      return;
    }
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    drawText(ctx, ball.hpText, 0, 1, HP_STYLE, this.scale * (Math.round(size * 4) / 4));
    ctx.restore();
  }

  // Royale: how many balls are left, in the top-left corner (in screen units).
  drawRemaining(sim, screen) {
    const left = sim.aliveBalls.length;
    const text = left === 2 ? 'FINAL TWO' : `${left} LEFT`;
    COUNT_STYLE.fill = left === 2 ? '#ffd23f' : 'rgba(255, 255, 255, 0.85)';
    drawText(this.ctx, text, 60, 12, COUNT_STYLE, screen);
  }

  // A fighter's name (e.g. its team) above the ball, or below it near the top wall.
  drawLabel(ball) {
    const above = ball.pos.y - ball.radius > LABEL_SIZE + 12;
    LABEL_STYLE.baseline = above ? 'bottom' : 'top';
    const y = above ? ball.pos.y - ball.radius - 8 : ball.pos.y + ball.radius + 8;
    drawText(this.ctx, ball.label, ball.pos.x, y, LABEL_STYLE, this.scale);
  }

  drawHitboxes(balls) {
    const { ctx } = this;
    for (const ball of balls) {
      ball.weapon.drawHitbox(ctx);
      ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ball.pos.x, ball.pos.y, ball.radius, 0, TAU);
      ctx.stroke();
    }
  }

  // A red border that pulses with each damage tick, and a label along the top wall.
  drawSuddenDeath(sim, width, height) {
    const { ctx } = this;
    const pulse = 0.55 + 0.45 * Math.cos(((sim.time - sim.suddenDeathAt) / CONFIG.suddenDeath.interval) * TAU);
    ctx.strokeStyle = `rgba(${COLORS.suddenDeath}, ${pulse})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, width - 6, height - 6);

    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(${COLORS.suddenDeath}, 0.85)`;
    ctx.fillText('SUDDEN DEATH', width / 2, 12);
  }

  drawBanner(width, height, title, color, subtitle) {
    const { ctx } = this;
    const y = height / 2;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, y - 50, width, 100);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color ?? '#ffffff';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText(title, width / 2, y - 10);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(subtitle, width / 2, y + 28);
  }
}

function winnerText({ winner, decidedBy }) {
  if (!winner) return 'DRAW';
  return `${winner.name.toUpperCase()} WINS${decidedBy === 'hp' ? ' ON HP' : ''}`;
}
