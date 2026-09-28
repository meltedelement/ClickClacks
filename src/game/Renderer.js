import { CONFIG } from '../config.js';
import { TAU } from '../sim/math.js';

const GRID_SPACING = 50;
const COLORS = {
  background: '#171a21',
  grid: 'rgba(255, 255, 255, 0.04)',
  border: '#3a4150',
  overlay: 'rgba(10, 12, 16, 0.7)',
};

// Draws a Simulation plus effects onto a canvas. Everything is drawn in arena
// units; the canvas backing store tracks its on-screen size so it stays sharp
// however big the arena is displayed.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    // Assigning canvas size wipes it, so only do it when the size really changed.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.scale = width / CONFIG.arena.width;
  }

  draw(sim, effects, { showHitboxes = false, paused = false } = {}) {
    const { ctx } = this;
    const { width, height } = sim.arena;

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    const shake = effects.shakeOffset();
    ctx.translate(shake.x, shake.y);

    this.drawGrid(width, height);
    const balls = sim.aliveBalls;
    for (const ball of balls) {
      ball.weapon.ability?.draw(ctx);
      for (const upgrade of ball.weapon.upgrades) upgrade.drawUnder(ctx);
    }
    for (const ball of balls) ball.draw(ctx);
    for (const ball of balls) ball.weapon.draw(ctx);
    for (const ball of balls) for (const upgrade of ball.weapon.upgrades) upgrade.drawOver(ctx);
    if (showHitboxes) this.drawHitboxes(balls);
    effects.draw(ctx);

    ctx.restore();

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);

    if (sim.over) this.drawBanner(width, height, winnerText(sim.winner), sim.winner?.color, 'R to restart');
    else if (paused) this.drawBanner(width, height, 'PAUSED', '#ffffff', 'Space to resume');
  }

  drawGrid(width, height) {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
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

function winnerText(winner) {
  return winner ? `${winner.name.toUpperCase()} WINS` : 'DRAW';
}
