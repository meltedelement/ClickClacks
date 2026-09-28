import { CONFIG } from '../config.js';
import { TAU, fromAngle, length, scale } from './math.js';
import { formatNumber } from '../utils/format.js';

export class Ball {
  constructor({ position, color, WeaponClass }) {
    this.pos = { ...position };
    this.radius = CONFIG.ball.radius;
    this.speed = CONFIG.ball.speed;
    this.vel = fromAngle(Math.random() * TAU, this.speed);
    this.maxHp = CONFIG.ball.maxHp;
    this.hp = this.maxHp;
    this.color = color;
    this.alive = true;
    this.flash = 0; // seconds left of the white hit flash

    // Weapon -> seconds until that weapon may hit this ball again.
    this.hitCooldowns = new Map();

    this.weapon = new WeaponClass(this);
  }

  get name() {
    return this.weapon.name;
  }

  update(dt, sim) {
    if (!this.weapon.controlsMovement) this.recoverSpeed(dt);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.weapon.update(dt, sim);

    for (const [weapon, time] of this.hitCooldowns) {
      if (time - dt <= 0) this.hitCooldowns.delete(weapon);
      else this.hitCooldowns.set(weapon, time - dt);
    }
    if (this.flash > 0) this.flash -= dt;
  }

  // Ease back towards cruising speed after being knocked around.
  recoverSpeed(dt) {
    const current = length(this.vel);
    if (current < 1e-6) {
      this.vel = fromAngle(Math.random() * TAU, this.speed);
      return;
    }
    const t = Math.min(1, dt * CONFIG.ball.speedRecovery);
    const next = current + (this.speed - current) * t;
    this.vel = scale(this.vel, next / current);
  }

  canBeHitBy(weapon) {
    return !this.hitCooldowns.has(weapon);
  }

  takeHit(weapon, damage) {
    this.hp = Math.max(0, this.hp - damage);
    this.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
    this.flash = 0.1;
    if (this.hp <= 0) this.alive = false;
  }

  draw(ctx) {
    const { x, y } = this.pos;
    const flashing = this.flash > 0;

    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, TAU);
    ctx.fillStyle = flashing ? '#ffffff' : this.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();

    ctx.fillStyle = flashing ? this.color : '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(this.hp), x, y + 1);
  }
}
