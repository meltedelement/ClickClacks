import { Ability } from './Ability.js';
import { TAU, angleOf, clamp, fromAngle, sub, vec } from '../sim/math.js';

// Vanish in a puff of smoke, reappear right behind the nearest enemy and stab:
// the next hit is a guaranteed crit. The strike ends on the first hit, a parry,
// or when it times out (a dodged stab).
export class Backstab extends Ability {
  static displayName = 'Backstab';

  constructor(weapon) {
    super(weapon, { cooldown: 6 });

    // Stats. Upgrades may change these.
    this.vanishTime = 0.35; // s standing in the smoke before the jump
    this.strikeTime = 0.7; // s the guaranteed crit waits for a hit after appearing
    this.strikeSpeed = 1.5; // x cruising speed, lunging at the target
    this.triggerRange = 520; // px; only vanishes when an enemy is this close
    this.appearGap = 8; // px between the two balls' edges on arrival
    this.fade = 0.25; // s the smoke takes to clear after appearing

    this.phase = null; // 'vanish' | 'strike'
    this.timer = 0;
    this.target = null;
    this.from = vec(0, 0); // where it vanished
    this.smoke = 0; // 0..1: how much of the ball the smoke hides
    this.arrival = 0; // s since appearing, for the ring (counts up while fading)
  }

  get spinMultiplier() {
    return this.active ? 0 : 1;
  }

  get controlsMovement() {
    return this.active;
  }

  get guaranteesCrit() {
    return this.phase === 'strike';
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    const { owner } = this;
    this.phase = 'vanish';
    this.timer = this.vanishTime;
    this.target = this.nearestEnemy(sim);
    this.from = { x: owner.pos.x, y: owner.pos.y };
    this.arrival = 0;
    owner.vel = vec(0, 0);
    this.emit(sim, 'vanish', { burst: { color: '#2b2438', count: 22, speed: 140, life: 0.5, size: 4 } });
  }

  onUpdate(dt, sim) {
    const { owner, weapon, target } = this;
    this.timer -= dt;
    this.arrival += dt;

    if (!target?.alive) {
      this.end(sim);
      return;
    }

    if (this.phase === 'vanish') {
      owner.vel = vec(0, 0);
      this.smoke = Math.min(1, 1 - this.timer / this.vanishTime);
      if (this.timer <= 0) this.appear(sim);
      return;
    }

    // Strike: lunge at the target with the dagger pointing at it.
    this.smoke = Math.max(0, 1 - this.arrival / this.fade);
    const toTarget = sub(target.pos, owner.pos);
    weapon.angle = angleOf(toTarget);
    owner.vel = fromAngle(weapon.angle, owner.cruiseSpeed * this.strikeSpeed);
    if (this.timer <= 0) this.end(sim);
  }

  // Jump to the spot behind the target (opposite the way it is heading).
  appear(sim) {
    const { owner, weapon, target } = this;
    const heading = target.vel.x || target.vel.y ? angleOf(target.vel) : angleOf(sub(target.pos, owner.pos)) + Math.PI;
    const gap = owner.radius + target.radius + this.appearGap;
    const arena = sim.arena;
    const to = {
      x: clamp(target.pos.x - Math.cos(heading) * gap, owner.radius, arena.width - owner.radius),
      y: clamp(target.pos.y - Math.sin(heading) * gap, owner.radius, arena.height - owner.radius),
    };
    this.from = { x: owner.pos.x, y: owner.pos.y };
    owner.pos.x = to.x;
    owner.pos.y = to.y;
    weapon.angle = angleOf(sub(target.pos, owner.pos));
    this.phase = 'strike';
    this.timer = this.strikeTime;
    this.arrival = 0;
    this.emit(sim, 'appear', { shake: 3, burst: { color: '#b48cff', count: 20, speed: 220, life: 0.35, size: 3 } });
  }

  onHit(target, sim) {
    if (this.phase === 'strike') this.end(sim);
  }

  onParry(otherWeapon, sim) {
    if (this.phase === 'strike') this.end(sim);
  }

  onEnd() {
    this.phase = null;
    this.target = null;
    this.smoke = 0;
  }

  // The trail between the two spots, and a ring where it arrived.
  draw(ctx) {
    if (!this.active || this.arrival > 0.5) return;
    const { owner } = this;
    const k = 1 - this.arrival / 0.5;
    ctx.save();
    if (this.phase === 'strike') {
      ctx.strokeStyle = '#b48cff';
      ctx.globalAlpha = 0.5 * k;
      ctx.lineWidth = owner.radius * 0.6 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.from.x, this.from.y);
      ctx.lineTo(owner.pos.x, owner.pos.y);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 6 + (1 - k) * 40, 0, TAU);
      ctx.stroke();
    } else {
      // Shrinking ring around the vanishing ball.
      ctx.strokeStyle = '#b48cff';
      ctx.globalAlpha = 0.3 + 0.5 * this.smoke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 4 + 18 * (1 - this.smoke), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Smoke over the ball (and the dagger): thickens as it vanishes, clears once it is there.
  drawOver(ctx) {
    if (!this.active || this.smoke <= 0) return;
    const { owner, weapon } = this;
    ctx.save();
    ctx.fillStyle = '#2b2438';
    ctx.globalAlpha = 0.92 * this.smoke;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius * (1.05 + 0.25 * (1 - this.smoke)), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.7 * this.smoke;
    ctx.lineWidth = weapon.thickness * 2.2;
    ctx.strokeStyle = '#2b2438';
    ctx.lineCap = 'round';
    const start = owner.radius + weapon.gap;
    const a = fromAngle(weapon.angle, start);
    const b = fromAngle(weapon.angle, start + weapon.length);
    ctx.beginPath();
    ctx.moveTo(owner.pos.x + a.x, owner.pos.y + a.y);
    ctx.lineTo(owner.pos.x + b.x, owner.pos.y + b.y);
    ctx.stroke();
    ctx.restore();
  }
}
