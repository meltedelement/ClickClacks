import { TAU, randomRange } from '../sim/math.js';

// Purely cosmetic stuff: sparks, floating damage numbers, and screen shake.
export class Effects {
  constructor() {
    this.clear();
  }

  clear() {
    this.particles = [];
    this.texts = [];
    this.shakeAmount = 0;
  }

  burst(pos, color, { count = 12, speed = 220, life = 0.45, size = 3 } = {}) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU;
      const s = speed * randomRange(0.3, 1);
      const l = life * randomRange(0.6, 1);
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * s,
        vy: Math.sin(angle) * s,
        life: l,
        maxLife: l,
        size: size * randomRange(0.6, 1.2),
        color,
      });
    }
  }

  floatingText(pos, text, color) {
    this.texts.push({ x: pos.x, y: pos.y, vy: -70, life: 0.9, maxLife: 0.9, text, color });
  }

  shake(amount) {
    this.shakeAmount = Math.min(this.shakeAmount + amount, 18);
  }

  shakeOffset() {
    const a = this.shakeAmount;
    return { x: randomRange(-a, a), y: randomRange(-a, a) };
  }

  update(dt) {
    const drag = Math.exp(-dt * 4);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.vy *= drag;
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    this.shakeAmount *= Math.exp(-dt * 14);
    if (this.shakeAmount < 0.1) this.shakeAmount = 0;
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }

    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, (t.life / t.maxLife) * 2);
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
