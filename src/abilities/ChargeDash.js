import { Ability } from './Ability.js';
import { TAU, angleOf, distance, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';

// Stop, aim at the nearest enemy, then lunge forward weapon-first.
// Getting hit while charging, or having the dash parried, cancels it.
export class ChargeDash extends Ability {
  static displayName = 'Charge Dash';

  constructor(weapon) {
    super(weapon, { cooldown: 7.5 });

    // Stats. Upgrades may change these.
    this.windup = 0.5; // seconds standing still while charging
    this.dashSpeed = 950; // px/s
    this.dashDuration = 0.4; // seconds, if it doesn't hit anything first
    this.dashDamageMultiplier = 2;
    this.dashKnockbackMultiplier = 1.6;
    this.triggerRange = 380; // px; only starts charging when an enemy is within this distance
    this.aimTurnRate = 10; // rad/s the weapon turns to track the target while charging
    this.recoil = 0.35; // fraction of dash speed kept after landing the hit

    this.phase = null; // 'windup' | 'dash'
    this.timer = 0;
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

  get controlsMovement() {
    return this.active;
  }

  shouldActivate(sim) {
    const enemy = this.nearestEnemy(sim);
    return enemy !== null && distance(enemy.pos, this.owner.pos) < this.triggerRange;
  }

  onStart(sim) {
    this.phase = 'windup';
    this.timer = this.windup;
    this.target = this.nearestEnemy(sim);
    this.emit(sim, 'charge');
  }

  onUpdate(dt, sim) {
    const { owner, weapon } = this;
    this.timer -= dt;

    if (this.phase === 'windup') {
      owner.vel = vec(0, 0);
      if (this.target?.alive) {
        const desired = angleOf(sub(this.target.pos, owner.pos));
        weapon.angle = turnTowards(weapon.angle, desired, this.aimTurnRate * dt);
      }
      if (this.timer <= 0) {
        this.phase = 'dash';
        this.timer = this.dashDuration;
        owner.vel = fromAngle(weapon.angle, this.dashSpeed);
        this.emit(sim, 'dash', { shake: 4, burst: { color: '#cfd6df', count: 16, speed: 180, life: 0.4 } });
      }
      return;
    }

    // Dashing: hold full speed, but follow wall bounces and keep the weapon pointing forward.
    owner.vel = scale(normalize(owner.vel), this.dashSpeed);
    weapon.angle = angleOf(owner.vel);
    if (this.timer <= 0) this.end(sim);
  }

  onEnd() {
    this.phase = null;
    this.target = null;
  }

  onHit(target, sim) {
    if (this.phase !== 'dash') return;
    this.owner.vel = scale(this.owner.vel, this.recoil);
    this.end(sim);
  }

  onParry(otherWeapon, sim) {
    if (this.phase === 'dash') this.end(sim);
  }

  onOwnerHit(attackerWeapon, sim) {
    if (this.phase === 'windup') this.end(sim);
  }

  draw(ctx) {
    if (this.phase === 'windup') this.drawWindup(ctx);
    else if (this.phase === 'dash') this.drawDash(ctx);
  }

  // Ring that tightens around the ball and a faint line showing where it'll go.
  drawWindup(ctx) {
    const { owner, weapon } = this;
    const progress = 1 - this.timer / this.windup;
    const { x, y } = owner.pos;

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.25 + 0.6 * progress;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, owner.radius + 4 + 16 * (1 - progress), 0, TAU);
    ctx.stroke();

    const start = fromAngle(weapon.angle, owner.radius + weapon.gap + weapon.length);
    const end = fromAngle(weapon.angle, owner.radius + weapon.gap + weapon.length + this.dashSpeed * this.dashDuration);
    ctx.globalAlpha = 0.25 * progress;
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + start.x, y + start.y);
    ctx.lineTo(x + end.x, y + end.y);
    ctx.stroke();
    ctx.restore();
  }

  // Afterimages trailing behind the ball.
  drawDash(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 4; i++) {
      const behind = scale(owner.vel, -0.018 * i);
      ctx.globalAlpha = 0.3 * (1 - i / 5);
      ctx.beginPath();
      ctx.arc(owner.pos.x + behind.x, owner.pos.y + behind.y, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
