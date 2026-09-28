import { Upgrade } from './Upgrade.js';
import { CONFIG } from '../config.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { SpearThrow } from '../abilities/SpearThrow.js';
import { Shield } from '../weapons/Shield.js';
import { Status } from '../sim/Status.js';
import { TAU, add, angleOf, distance, fromAngle, normalize, scale, sub } from '../sim/math.js';

// Transformations for the Spear: big upgrades that change how it fights. Like
// the Sword's, they combine with each other and with the small upgrades, and
// are applied before the small ones.

class SpearTransformation extends Upgrade {
  static weapons = ['spear'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Hoplite --------------------------------------------------------------------

const HOPLITE_OFFSET = -1.1; // radians: to the left of the spear

export class Hoplite extends SpearTransformation {
  static id = 'hoplite';
  static displayName = 'Hoplite';
  static description = 'Gain a shield like the Sword\'s, just to the left of your spear. It blocks enemy weapons.';

  apply() {
    this.weapon.shields.push(new Shield(this.weapon, { offset: HOPLITE_OFFSET, width: 34 }));
  }
}

// ---- Poseidon -------------------------------------------------------------------

const IMPALE_COLOR = '#5ec8e5';

export class Poseidon extends SpearTransformation {
  static id = 'poseidon';
  static displayName = 'Poseidon';
  static description =
    'Your spear becomes a trident with a big head. Hitting with the head skewers the enemy: they are carried on it for 0.7 s, then take a second hit at half damage and are flung off.';

  constructor(weapon) {
    super(weapon);
    this.headBonus = 14; // px longer head than a plain spear's, all of it counting as head hits
    this.holdTime = 0.7; // s the enemy stays skewered
    this.wallHoldTime = 0.2; // s after which touching a wall rips them off early
    this.releaseDamageMultiplier = 0.5;
    this.releaseKnockbackMultiplier = 1.4;
    this.depth = 0.6; // how far into the enemy the tip sinks, as a share of their radius
    this.cooldown = 2.5; // s after flinging someone off before the next skewer

    this.target = null; // the skewered ball
    this.bladeIndex = 0; // which blade they're on
    this.timer = 0;
    this.cooldownLeft = 0;
    this.releasing = false; // true during the release hit, so it doesn't skewer again
  }

  apply() {
    this.weapon.head = 'trident';
    this.weapon.headLength += this.headBonus;
  }

  // Their weapon would clash with the shaft they're stuck on; let everything pass through.
  get unblockable() {
    return this.target !== null;
  }

  get damageMultiplier() {
    return this.releasing ? this.releaseDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.releasing ? this.releaseKnockbackMultiplier : 1;
  }

  onHit(target, sim, damage, point) {
    if (this.releasing || this.target || this.cooldownLeft > 0 || sim.over || !target.alive) return;
    if (this.weapon.disarmed || !this.weapon.headHit(point)) return;
    this.target = target;
    this.bladeIndex = nearestBlade(this.weapon, angleOf(sub(point, this.owner.pos)));
    this.timer = this.holdTime;
    target.addStatus(new Impaled({ source: this.owner, holder: this }), sim);
    this.emit(sim, 'impale', { pos: target.pos, shake: 3, text: 'IMPALED', color: IMPALE_COLOR });
  }

  onUpdate(dt, sim) {
    const { target, weapon } = this;
    if (!target) {
      if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
      return;
    }
    if (!target.alive || sim.over || weapon.disarmed) {
      this.letGo();
      return;
    }
    // Stuck on the head, so it keeps "touching" them; don't let that count as hits.
    target.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
    this.timer -= dt;
    const held = this.holdTime - this.timer;
    if (this.timer <= 0 || (held >= this.wallHoldTime && touchesWall(this.skewerPoint(), target.radius, sim.arena))) {
      this.release(sim);
    }
  }

  // The second, weaker hit, which also flings them off the tip.
  release(sim) {
    const { target, owner, weapon } = this;
    const tip = add(owner.pos, fromAngle(this.bladeAngle(), owner.radius + weapon.gap + weapon.length));
    this.letGo();
    target.clearHitCooldown(weapon);
    this.releasing = true;
    sim.applyHit(owner, target, tip);
    this.releasing = false;
  }

  letGo() {
    this.target = null;
    this.cooldownLeft = this.cooldown;
  }

  bladeAngle() {
    const angles = this.weapon.bladeAngles();
    return angles[Math.min(this.bladeIndex, angles.length - 1)];
  }

  // Where the skewered ball's centre sits: just past the tip, with the head sunk into it.
  skewerPoint() {
    const { owner, weapon, target } = this;
    const reach = owner.radius + weapon.gap + weapon.length + target.radius * (1 - this.depth);
    return add(owner.pos, fromAngle(this.bladeAngle(), reach));
  }
}

// On a Poseidon trident. Holds the ball on the tip until the holder lets go.
export class Impaled extends Status {
  constructor({ source, holder }) {
    super({ source, duration: Infinity });
    this.holder = holder;
  }

  get expired() {
    return this.holder.target !== this.ball;
  }

  onApply() {
    this.pin();
  }

  onUpdate() {
    if (!this.expired) this.pin();
  }

  pin() {
    const point = this.holder.skewerPoint();
    this.ball.pos.x = point.x;
    this.ball.pos.y = point.y;
  }

  // A pulsing sea-blue ring.
  draw(ctx) {
    const { pos, radius } = this.ball;
    ctx.save();
    ctx.strokeStyle = IMPALE_COLOR;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.age * 25);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function nearestBlade(weapon, angle) {
  let best = 0;
  let bestGap = Infinity;
  weapon.bladeAngles().forEach((a, i) => {
    const gap = Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle)));
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

function touchesWall({ x, y }, radius, arena) {
  return x < radius || y < radius || x > arena.width - radius || y > arena.height - radius;
}

// ---- Dancer ---------------------------------------------------------------------

// The Dancer's spin: a Spin Swipe that waits for the spear's own ability to finish.
class DanceSpin extends SpinSwipe {
  static displayName = 'Dance';

  shouldActivate(sim) {
    return !this.weapon.ability?.active && super.shouldActivate(sim);
  }
}

const RIBBON = '#e8579a';

export class Dancer extends SpearTransformation {
  static id = 'dancer';
  static displayName = 'Dancer';
  static description = 'Every 5 s, when the enemy is close, whirl your spear through a fast full turn (like Spin Swipe) for 30% more damage.';

  constructor(weapon) {
    super(weapon);
    this.spin = new DanceSpin(weapon);
    this.spin.cooldown = 5;
    this.spin.cooldownLeft = 2.5;
    this.spin.swipeSpinMultiplier = 5;
    this.spin.swipeDamageMultiplier = 1.3;
  }

  get spinMultiplier() {
    return this.spin.spinMultiplier;
  }

  get damageMultiplier() {
    return this.spin.damageMultiplier;
  }

  onUpdate(dt, sim) {
    this.spin.update(dt, sim);
  }

  drawUnder(ctx) {
    this.spin.draw(ctx);
  }

  // Two ribbons tied below the head, streaming out further while it whirls.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - this.weapon.headLength - 8;
    const trail = this.spin.active ? 20 : 11;
    ctx.save();
    ctx.fillStyle = RIBBON;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, side * 2.5);
      ctx.quadraticCurveTo(x - trail * 0.5, side * 9, x - trail, side * 5);
      ctx.lineTo(x - trail + 3, side * 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Bouncer --------------------------------------------------------------------

const PULSE_COLOR = '#b69cff';
const PULSE_TIME = 0.3; // s the ring takes to spread

export class Bouncer extends SpearTransformation {
  static id = 'bouncer';
  static displayName = 'Bouncer';
  static description = 'Landing a hit sends out a repelling pulse as far as your spear reaches, dealing 3 damage and throwing enemies straight away from you (at most once a second).';

  constructor(weapon) {
    super(weapon);
    this.pulseKnockback = 1.8; // enemies fly off at their speed x this
    this.pulseDamage = 3; // to everyone the pulse catches, on top of the hit
    this.cooldown = 1; // s between pulses
    this.cooldownLeft = 0;
    this.ring = 0; // s left of the spreading ring
    this.ringRadius = 0;
  }

  get reach() {
    const { owner, weapon } = this;
    return owner.radius + weapon.gap + weapon.length;
  }

  onUpdate(dt) {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
    if (this.ring > 0) this.ring -= dt;
  }

  onHit(target, sim) {
    if (this.cooldownLeft > 0 || sim.over) return;
    this.cooldownLeft = this.cooldown;
    const { owner } = this;
    const reach = this.reach;
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      if (enemy !== target && distance(enemy.pos, owner.pos) > reach + enemy.radius) continue;
      enemy.vel = scale(normalize(sub(enemy.pos, owner.pos)), enemy.speed * this.pulseKnockback);
      sim.dealDamage(owner, enemy, this.pulseDamage, { reason: 'pulse', color: PULSE_COLOR });
    }
    this.ring = PULSE_TIME;
    this.ringRadius = reach;
    this.emit(sim, 'pulse', { shake: 3 });
  }

  drawOver(ctx) {
    if (this.ring <= 0) return;
    const { owner } = this;
    const t = 1 - this.ring / PULSE_TIME;
    ctx.save();
    ctx.strokeStyle = PULSE_COLOR;
    ctx.globalAlpha = 0.8 * (1 - t);
    ctx.lineWidth = 6 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + (this.ringRadius - owner.radius) * t, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // A round bumper on the shaft near the hilt.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = PULSE_COLOR;
    ctx.beginPath();
    ctx.arc(start + 14, 0, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---- Olympian -------------------------------------------------------------------

export class Olympian extends SpearTransformation {
  static id = 'olympian';
  static displayName = 'Olympian';
  static description =
    'Charge Dash becomes Spear Throw: hurl your spear for double damage and huge knockback, then dash to pick it up, ramming enemies on the way. Unarmed until you catch it.';

  apply() {
    this.weapon.ability = new SpearThrow(this.weapon);
  }
}

// ---- Tactician ------------------------------------------------------------------

export class Tactician extends SpearTransformation {
  static id = 'tactician';
  static displayName = 'Tactician';
  static description = 'Your spear head is longer, and hits with it always crit. Hits with the shaft deal 40% less damage.';

  constructor(weapon) {
    super(weapon);
    this.shaftDamage = 0.6;
    this.headBonus = 22; // px longer head, so more hits land with the point
  }

  apply() {
    this.weapon.headLength += this.headBonus;
  }

  // A thrown spear or a ram isn't aimed with the point, so those count as normal hits.
  critsAt(point) {
    return !this.weapon.disarmed && this.weapon.headHit(point);
  }

  damageMultiplierAt(point) {
    if (this.weapon.disarmed || this.weapon.headHit(point)) return 1;
    return this.shaftDamage;
  }

  // Red binding marking where the head starts.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - this.weapon.headLength - 9;
    ctx.save();
    ctx.fillStyle = '#d43a3a';
    ctx.fillRect(x, -3.5, 3, 7);
    ctx.restore();
  }
}

// ---- Tackler --------------------------------------------------------------------

const GUARD_BREAK_COLOR = '#ff9f43';

export class Tackler extends SpearTransformation {
  static id = 'tackler';
  static displayName = 'Tackler';
  static description = "When your spear clashes with a weapon or shield, the enemy's guard breaks for 2.5 s: their weapon and shields can't block, and weapons pass straight through them.";

  constructor(weapon) {
    super(weapon);
    this.duration = 2.5;
  }

  onParry(otherWeapon, sim) {
    const enemy = otherWeapon.owner;
    if (!enemy.alive || sim.over) return;
    enemy.addStatus(new GuardBroken({ source: this.owner, duration: this.duration }), sim);
    this.emit(sim, 'tackle', { pos: enemy.pos, text: 'GUARD BROKEN', color: GUARD_BREAK_COLOR, burst: { color: GUARD_BREAK_COLOR, count: 10, speed: 200, life: 0.35 } });
  }

  // Leather padding wrapped around the shaft.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = '#5a3d24';
    ctx.fillRect(start + 6, -4, 20, 8);
    ctx.restore();
  }
}

// From Tackler: the ball's weapon and shields can't block for a while.
export class GuardBroken extends Status {
  get guardBroken() {
    return true;
  }

  // Broken ring segments circling the ball, fading at the end.
  draw(ctx) {
    const { pos, radius } = this.ball;
    const pieces = 5;
    ctx.save();
    ctx.strokeStyle = GUARD_BREAK_COLOR;
    ctx.globalAlpha = 0.8 * Math.min(1, this.timeLeft / 0.3);
    ctx.lineWidth = 3;
    for (let i = 0; i < pieces; i++) {
      const a = this.age * 2 + (i * TAU) / pieces;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius + 5 + (i % 2) * 3, a, a + 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Runner ---------------------------------------------------------------------

const RUNNER_COLOR = '#9fe8ff';

export class Runner extends SpearTransformation {
  static id = 'runner';
  static displayName = 'Runner';
  static description = "Every parry takes 1 s off your Charge Dash's cooldown.";

  constructor(weapon) {
    super(weapon);
    this.refund = 1; // s off the cooldown per parry
  }

  onParry(otherWeapon, sim) {
    const { ability } = this;
    if (!ability || ability.active || ability.cooldownLeft <= 0) return;
    ability.cooldownLeft = Math.max(0, ability.cooldownLeft - this.refund);
    this.emit(sim, 'hasten', { burst: { color: RUNNER_COLOR, count: 6, speed: 140, life: 0.3 } });
  }

  // Little wings on the shaft near the hilt.
  drawBlade(ctx, start) {
    const x = start + 30;
    ctx.save();
    ctx.fillStyle = '#f2f4f7';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, side * 2.5);
      ctx.lineTo(x - 12, side * 11);
      ctx.lineTo(x - 8, side * 6);
      ctx.lineTo(x - 14, side * 5);
      ctx.lineTo(x - 6, side * 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
