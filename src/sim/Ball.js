import { CONFIG } from '../config.js';
import { TAU, fromAngle, length, scale } from './math.js';
import { formatNumber } from '../utils/format.js';

export class Ball {
  // `upgrades` are Upgrade classes, applied in order once the weapon is built.
  // A class listed more than once stacks onto the same instance.
  constructor({ position, color, WeaponClass, upgrades = [] }) {
    this.pos = { ...position };
    this.radius = CONFIG.ball.radius;
    this.speed = CONFIG.ball.speed;
    const heading = Math.random() * TAU;
    this.maxHp = CONFIG.ball.maxHp;
    this.armor = 0; // taken off every weapon hit, but a hit is never reduced below half
    this.dodgeChance = 0; // 0–1 chance a weapon hit misses completely
    this.color = color;
    this.alive = true;
    this.flash = 0; // seconds left of the white hit flash

    // Weapon -> seconds until that weapon may hit this ball again.
    this.hitCooldowns = new Map();

    this.weapon = new WeaponClass(this);
    for (const UpgradeClass of upgrades) {
      let upgrade = this.weapon.upgrades.find((u) => u.constructor === UpgradeClass);
      if (!upgrade) {
        upgrade = new UpgradeClass(this.weapon);
        this.weapon.upgrades.push(upgrade);
      }
      upgrade.stacks += 1;
      upgrade.apply();
    }

    // Set last so upgrades to speed or maxHp count from the start.
    this.vel = fromAngle(heading, this.speed);
    this.hp = this.maxHp;
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

  // Lets `weapon` hit this ball again straight away (e.g. for rapid multi-hit moves).
  clearHitCooldown(weapon) {
    this.hitCooldowns.delete(weapon);
  }

  canBeHitBy(weapon) {
    return !this.hitCooldowns.has(weapon);
  }

  // Rolls this ball's dodge chance. Only uses Math.random when there is a chance
  // to dodge, so fights without dodging play out the same as before it existed.
  dodges() {
    return this.dodgeChance > 0 && Math.random() < this.dodgeChance;
  }

  // Damage actually taken from a weapon hit of `damage`, after armor and modifiers.
  reduceDamage(damage) {
    const armored = Math.max(damage / 2, damage - this.armor);
    return armored * this.weapon.damageTakenMultiplier;
  }

  takeHit(weapon, damage) {
    this.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
    return this.takeDamage(damage);
  }

  // Removes HP. Returns how much was actually lost (no overkill).
  takeDamage(damage) {
    const lost = Math.min(this.hp, damage);
    this.hp -= lost;
    this.flash = 0.1;
    if (this.hp <= 0) this.alive = false;
    return lost;
  }

  // Restores HP up to maxHp. Returns how much was actually healed.
  heal(amount) {
    if (!this.alive) return 0;
    const healed = Math.min(this.maxHp - this.hp, amount);
    this.hp += healed;
    return healed;
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
