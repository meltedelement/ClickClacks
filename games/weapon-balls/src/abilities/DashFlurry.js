import { Ability } from './Ability.js';
import { TAU, angleOf, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';

// Gather every blade together at the front, then three quick dashes at the
// enemy. Between dashes the ball keeps moving while it re-aims. Each dash can
// land its own hit.
export class DashFlurry extends Ability {
  static displayName = 'Dash Flurry';

  constructor(weapon) {
    super(weapon, { cooldown: 7 });

    // Stats. Upgrades may change these.
    this.gatherTime = 0.25; // seconds stopped while the blades swing together and aim
    this.dashes = 3;
    this.aimTime = 0.25; // seconds between dashes, moving freely while re-aiming
    this.aimTurnRate = 30; // rad/s
    this.dashSpeed = 850; // px/s
    this.dashDuration = 0.2; // seconds per dash, if it doesn't hit first
    this.dashDamageMultiplier = 0.7; // each dash is a light hit
    this.dashKnockbackMultiplier = 0.6; // keep the target close for the next dash
    this.triggerRange = 300; // px; only starts when an enemy is within this distance
    this.recoil = 0.3; // fraction of dash speed kept after a dash lands

    this.phase = null; // 'gather' | 'aim' | 'dash'
    this.timer = 0;
    this.dashesLeft = 0;
    this.target = null;
  }

  get spinMultiplier() {
    return this.active ? 0 : 1;
  }

  get damageMultiplier() {
    return this.phase === 'dash' ? this.dashDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'dash' ? this.dashKnockbackMultiplier : 1;
  }

  // Stopped while gathering and steering while dashing; free to move between dashes.
  get controlsMovement() {
    return this.phase === 'gather' || this.phase === 'dash';
  }

  get bladeSpread() {
    return this.active ? 0 : 1;
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    this.target = this.nearestEnemy(sim);
    this.dashesLeft = this.dashes;
    this.phase = 'gather';
    this.timer = this.gatherTime;
  }

  onUpdate(dt, sim) {
    const { owner, weapon } = this;
    this.timer -= dt;

    if (this.phase === 'gather' || this.phase === 'aim') {
      if (this.phase === 'gather') owner.vel = vec(0, 0);
      if (this.target?.alive) {
        const desired = angleOf(sub(this.target.pos, owner.pos));
        weapon.angle = turnTowards(weapon.angle, desired, this.aimTurnRate * dt);
      }
      if (this.timer <= 0) this.startDash(sim);
      return;
    }

    owner.vel = scale(normalize(owner.vel), this.dashSpeed);
    weapon.angle = angleOf(owner.vel);
    if (this.timer <= 0) this.finishDash(sim);
  }

  startDash(sim) {
    this.phase = 'dash';
    this.timer = this.dashDuration;
    this.dashesLeft -= 1;
    this.owner.vel = fromAngle(this.weapon.angle, this.dashSpeed);
    // Each dash is its own attack, so the normal hit cooldown doesn't block it.
    this.target?.clearHitCooldown(this.weapon);
    this.emit(sim, 'dash', { shake: 1.5 });
  }

  finishDash(sim) {
    if (this.dashesLeft > 0 && this.target?.alive) {
      this.phase = 'aim';
      this.timer = this.aimTime;
    } else {
      this.end(sim);
    }
  }

  onEnd() {
    this.phase = null;
    this.target = null;
  }

  onHit(target, sim) {
    if (this.phase !== 'dash') return;
    this.owner.vel = scale(this.owner.vel, this.recoil);
    this.finishDash(sim);
  }

  // A parried dash stops early, but the flurry carries on.
  onParry(otherWeapon, sim) {
    if (this.phase === 'dash') this.finishDash(sim);
  }

  // Short afterimages while dashing.
  draw(ctx) {
    if (this.phase !== 'dash') return;
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 3; i++) {
      const behind = scale(owner.vel, -0.015 * i);
      ctx.globalAlpha = 0.3 * (1 - i / 4);
      ctx.beginPath();
      ctx.arc(owner.pos.x + behind.x, owner.pos.y + behind.y, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
