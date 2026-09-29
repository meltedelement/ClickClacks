import { TAU, randomRange } from '../sim/math.js';

// Purely cosmetic stuff: sparks, floating damage numbers, and screen shake.
//
// This is the hottest drawing path in the game (a fight can have a thousand
// live sparks), so particles are pooled and drawn as a cached sprite blit
// instead of a fresh arc path each. `setProfile` lets the quality controller
// thin effects out when several arenas run at once.
const DEFAULT_BUDGET = 1400; // live particles per arena
const DEFAULT_TEXT_BUDGET = 40;
const SPRITE_SIZE = 32; // px radius of the cached spark sprite
const MAX_SPRITE_COLORS = 128; // spark colours are cached; team colours can be arbitrary
const SPRITE_RADIUS = SPRITE_SIZE - 1;

// One disc per colour, drawn once and blitted per particle. `globalAlpha` does
// the fade, so the sprite itself is opaque.
const sprites = new Map();

function spriteFor(color) {
  let sprite = sprites.get(color);
  if (sprite !== undefined) return sprite;
  // Team colours come from the match API, so cap the cache and evict the oldest.
  if (sprites.size >= MAX_SPRITE_COLORS) sprites.delete(sprites.keys().next().value);
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  sprite = null;
  if (canvas?.getContext) {
    canvas.width = SPRITE_SIZE * 2;
    canvas.height = SPRITE_SIZE * 2;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(SPRITE_SIZE, SPRITE_SIZE, SPRITE_RADIUS, 0, TAU);
      ctx.fill();
      sprite = canvas;
    }
  }
  sprites.set(color, sprite); // null = no 2D canvas here, fall back to paths
  return sprite;
}

export class Effects {
  constructor() {
    this.particles = [];
    this.texts = [];
    this.freeParticles = []; // recycled particle objects, so the loop allocates nothing
    this.freeTexts = [];
    this.budget = DEFAULT_BUDGET;
    this.textBudget = DEFAULT_TEXT_BUDGET;
    this.scale = 1; // <1 thins every burst out
    this.dropped = 0; // particles refused by the budget since the last clear
    this.shakeAmount = 0;
    this._offset = { x: 0, y: 0 };
  }

  clear() {
    this.particles.length = 0;
    this.texts.length = 0;
    this.freeParticles.length = 0;
    this.freeTexts.length = 0;
    this.dropped = 0;
    this.shakeAmount = 0;
  }

  // Called by the quality controller: fewer particles and smaller bursts when
  // frames are being dropped. A budget of 0 only stops new spawns.
  setProfile({ budget = this.budget, scale = this.scale } = {}) {
    this.budget = Math.max(0, budget);
    this.scale = Math.max(0, scale);
  }

  burst(pos, color, { count = 12, speed = 220, life = 0.45, size = 3 } = {}) {
    const n = this.scale >= 1 ? count : Math.round(count * this.scale);
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= this.budget) {
        this.dropped += 1;
        return;
      }
      const angle = Math.random() * TAU;
      const s = speed * randomRange(0.3, 1);
      const l = life * randomRange(0.6, 1);
      const p = this.freeParticles.pop();
      const particle = p ?? {};
      particle.x = pos.x;
      particle.y = pos.y;
      particle.vx = Math.cos(angle) * s;
      particle.vy = Math.sin(angle) * s;
      particle.life = l;
      particle.maxLife = l;
      particle.size = size * randomRange(0.6, 1.2);
      particle.color = color;
      this.particles.push(particle);
    }
  }

  floatingText(pos, text, color) {
    if (this.texts.length >= this.textBudget) return;
    const t = this.freeTexts.pop() ?? {};
    t.x = pos.x;
    t.y = pos.y;
    t.vy = -70;
    t.life = 0.9;
    t.maxLife = 0.9;
    t.text = text;
    t.color = color;
    this.texts.push(t);
  }

  shake(amount) {
    this.shakeAmount = Math.min(this.shakeAmount + amount, 18);
  }

  // Reused object: callers read x/y immediately, and a fresh one per frame is
  // pure garbage.
  shakeOffset() {
    const a = this.shakeAmount;
    this._offset.x = randomRange(-a, a);
    this._offset.y = randomRange(-a, a);
    return this._offset;
  }

  update(dt) {
    const drag = Math.exp(-dt * 4);

    // Compact in place (writing over the dead entries we have already passed),
    // recycling dead objects instead of allocating a filtered array per frame.
    const particles = this.particles;
    let live = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
      if (p.life > 0) particles[live++] = p;
      else this.freeParticles.push(p);
    }
    particles.length = live;

    const texts = this.texts;
    live = 0;
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      t.y += t.vy * dt;
      t.vy *= drag;
      t.life -= dt;
      if (t.life > 0) texts[live++] = t;
      else this.freeTexts.push(t);
    }
    texts.length = live;

    this.shakeAmount *= Math.exp(-dt * 14);
    if (this.shakeAmount < 0.1) this.shakeAmount = 0;
  }

  draw(ctx) {
    const particles = this.particles;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = p.life / p.maxLife;
      const sprite = spriteFor(p.color);
      if (sprite) {
        const r = p.size;
        ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      } else {
        // No offscreen canvas (tests, exotic workers): the old path drawing.
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }

    if (this.texts.length > 0) {
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
    }
    ctx.globalAlpha = 1;
  }
}
