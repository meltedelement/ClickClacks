import { Ability } from './Ability.js';
import { TAU, add, angleOf, clamp, closestPointOnSegment, distance, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';

const SAW_SCALE = 0.7; // the flying saw is the blades drawn this much smaller, around a hub
const HUB = 6; // px from the saw's centre to where the blades start, before scaling
const MAX_RETURN_TIME = 2; // s; safety net in case it somehow never gets back

// The Saw transformation's replacement for Dash Flurry: stop and gather the
// blades, then launch them together as a spinning buzzsaw that chases the
// enemy, landing a light hit every `hitInterval` while it's on them. It grinds
// straight through enemy weapons; only a shield touching it stops its hits
// (for that step, not the saw). When its time is up it flies back. The ball is
// unarmed until then.
export class Buzzsaw extends Ability {
  static displayName = 'Buzzsaw';

  constructor(weapon) {
    super(weapon, { cooldown: 7 });

    // Stats. Upgrades may change these.
    this.gatherTime = 0.3; // s stopped while the blades swing together
    this.sawTime = 2; // s the saw chases the enemy
    this.sawSpeed = 420; // px/s
    this.turnRate = 6; // rad/s the saw can turn while chasing
    this.returnSpeed = 750; // px/s
    this.sawSpinSpeed = 30; // rad/s
    this.sawDamageMultiplier = 0.4; // each hit is a nick
    this.sawKnockbackMultiplier = 0.3; // keep the target in the teeth
    this.hitInterval = 0.1; // s between hits on the same enemy, instead of the usual hit cooldown
    this.triggerRange = 300; // px; only starts when an enemy is within this distance

    this.phase = null; // 'gather' | 'saw' | 'return'
    this.timer = 0;
    this.target = null;
    this.saw = null; // { pos, heading, spin } while it's out of hand
    this.hitting = false; // true while the saw's own hit is being applied
  }

  // Hit radius of the flying saw: the tips of the scaled-down blades.
  get sawRadius() {
    const { weapon } = this;
    return SAW_SCALE * (HUB + weapon.length + weapon.thickness);
  }

  get spinMultiplier() {
    return this.phase === 'gather' ? 0 : 1;
  }

  get bladeSpread() {
    return this.phase === 'gather' ? 0 : 1;
  }

  get damageMultiplier() {
    return this.hitting ? this.sawDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.hitting ? this.sawKnockbackMultiplier : 1;
  }

  get controlsMovement() {
    return this.phase === 'gather';
  }

  get disarmed() {
    return this.saw !== null;
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    this.target = this.nearestEnemy(sim);
    this.phase = 'gather';
    this.timer = this.gatherTime;
  }

  onUpdate(dt, sim) {
    this.timer -= dt;
    if (this.phase === 'gather') this.updateGather(dt, sim);
    else if (this.phase === 'saw') this.updateSaw(dt, sim);
    else this.updateReturn(dt, sim);
  }

  updateGather(dt, sim) {
    const { owner, weapon } = this;
    owner.vel = vec(0, 0);
    if (this.target?.alive) weapon.angle = turnTowards(weapon.angle, angleOf(sub(this.target.pos, owner.pos)), 20 * dt);
    if (this.timer > 0) return;
    this.phase = 'saw';
    this.timer = this.sawTime;
    this.saw = { pos: add(owner.pos, fromAngle(weapon.angle, owner.radius + weapon.gap + weapon.length / 2)), heading: weapon.angle, spin: weapon.angle };
    this.emit(sim, 'saw', { shake: 2 });
  }

  // Chase the target, grinding into it whenever it's touching.
  updateSaw(dt, sim) {
    const { saw, target } = this;
    saw.spin += this.sawSpinSpeed * this.weapon.spinDir * dt;
    if (target?.alive) saw.heading = turnTowards(saw.heading, angleOf(sub(target.pos, saw.pos)), this.turnRate * dt);
    saw.pos = add(saw.pos, fromAngle(saw.heading, this.sawSpeed * dt));
    saw.pos = vec(clamp(saw.pos.x, 0, sim.arena.width), clamp(saw.pos.y, 0, sim.arena.height));

    if (!sim.over) {
      const radius = this.sawRadius;
      for (const enemy of sim.aliveBalls) {
        if (enemy === this.owner || !enemy.canBeHitBy(this.weapon)) continue;
        if (distance(enemy.pos, saw.pos) >= enemy.radius + radius || this.guarded(enemy, radius)) continue;
        const point = add(enemy.pos, scale(normalize(sub(saw.pos, enemy.pos)), enemy.radius));
        this.hitting = true;
        sim.applyHit(this.owner, enemy, point);
        this.hitting = false;
      }
    }

    if (this.timer <= 0 || !target?.alive) {
      this.phase = 'return';
      this.timer = MAX_RETURN_TIME;
    }
  }

  // True if one of `enemy`'s shields is touching the saw: it blocks the hit this step.
  guarded(enemy, radius) {
    if (enemy.guardBroken) return false;
    return enemy.weapon.heldShields.some((shield) => {
      const { a, b } = shield.getSegment();
      return distance(closestPointOnSegment(this.saw.pos, a, b), this.saw.pos) < radius + shield.thickness;
    });
  }

  updateReturn(dt, sim) {
    const { owner, saw } = this;
    saw.spin += this.sawSpinSpeed * this.weapon.spinDir * dt;
    const step = this.returnSpeed * dt;
    if (distance(owner.pos, saw.pos) <= owner.radius + step || this.timer <= 0) {
      this.emit(sim, 'catch');
      this.end(sim);
      return;
    }
    saw.pos = add(saw.pos, scale(normalize(sub(owner.pos, saw.pos)), step));
  }

  onEnd() {
    this.phase = null;
    this.target = null;
    this.saw = null;
  }

  // Bite again soon instead of waiting out the normal hit cooldown.
  onHit(target) {
    if (this.hitting) target.hitCooldowns.set(this.weapon, this.hitInterval);
  }

  // The flying saw: a blurred disc with the blades spinning around a hub.
  drawOver(ctx) {
    if (!this.saw) return;
    const { weapon } = this;
    const { pos, spin } = this.saw;
    const n = weapon.blades;
    ctx.save();
    ctx.translate(pos.x, pos.y);

    ctx.fillStyle = '#e3e8ee';
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(0, 0, this.sawRadius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.scale(SAW_SCALE, SAW_SCALE);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate(spin + (i * TAU) / n);
      ctx.scale(1, weapon.widthScale);
      weapon.drawBladeAt(ctx, HUB);
      ctx.restore();
    }
    ctx.fillStyle = '#4a4f57';
    ctx.beginPath();
    ctx.arc(0, 0, HUB + 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
