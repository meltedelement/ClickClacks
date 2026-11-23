import { Backstab } from './Backstab.js';
import { TAU, angleOf, clamp, fromAngle, sub, vec } from '../sim/math.js';

// The Saw transformation's Backstab: vanish and reappear behind the nearest
// enemy, lunge, and on the first hit latch on and saw. The ball rides the
// enemy, landing a light hit every `hitInterval`, until anything hits it
// (swatted away), it is parried, the enemy dies, or the time runs out.
export class Sawblade extends Backstab {
  static displayName = 'Sawblade';

  constructor(weapon) {
    super(weapon);
    this.cooldown = 7;
    this.latchTime = 3; // s it can saw for
    this.sawDamageMultiplier = 0.4; // each tooth is a nick
    this.sawKnockbackMultiplier = 0; // leaves the enemy's movement alone, so it isn't bounced about
    this.hitInterval = 0.1; // s between hits while latched
    this.latchAngle = 0; // from the enemy to this ball
  }

  get guaranteesCrit() {
    return false;
  }

  get latched() {
    return this.phase === 'latch';
  }

  get damageMultiplier() {
    return this.latched ? this.sawDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.latched ? this.sawKnockbackMultiplier : 1;
  }

  get unstoppable() {
    return this.latched;
  }

  onUpdate(dt, sim) {
    if (!this.latched) {
      super.onUpdate(dt, sim);
      return;
    }
    const { owner, target, weapon } = this;
    this.timer -= dt;
    this.arrival += dt;
    if (!target?.alive || this.timer <= 0) {
      this.end(sim);
      return;
    }
    const arena = sim.arena;
    const gap = owner.radius + target.radius - 3;
    const spot = fromAngle(this.latchAngle, gap);
    owner.pos.x = clamp(target.pos.x + spot.x, owner.radius, arena.width - owner.radius);
    owner.pos.y = clamp(target.pos.y + spot.y, owner.radius, arena.height - owner.radius);
    owner.vel = vec(target.vel.x, target.vel.y);
    weapon.angle = angleOf(sub(target.pos, owner.pos));
  }

  // The first hit of the lunge latches on; later ones keep sawing.
  onHit(target, sim) {
    if (this.phase === 'strike') {
      this.phase = 'latch';
      this.timer = this.latchTime;
      this.target = target;
      this.latchAngle = angleOf(sub(this.owner.pos, target.pos));
      this.smoke = 0;
      this.emit(sim, 'latch', { shake: 2, burst: { color: '#e3e8ee', count: 10, speed: 160, life: 0.3, size: 2 } });
    }
    if (this.latched) target.hitCooldowns.set(this.weapon, this.hitInterval);
  }

  // Swatted away.
  onOwnerHit(attackerWeapon, sim) {
    if (this.latched) this.end(sim);
  }

  onParry(otherWeapon, sim) {
    if (this.phase === 'strike' || this.latched) this.end(sim);
  }

  draw(ctx) {
    if (this.latched) return;
    super.draw(ctx);
  }
}
