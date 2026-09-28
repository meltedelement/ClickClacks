import { Ability } from './Ability.js';
import { TAU, distance } from '../sim/math.js';

const TRAIL_ARC = 2.2; // radians of motion trail behind the blade

// A full, very fast rotation of the weapon that hits harder than normal.
export class SpinSwipe extends Ability {
  static displayName = 'Spin Swipe';

  constructor(weapon) {
    super(weapon, { cooldown: 4.5 });

    // Stats. Upgrades may change these.
    this.swipeSpinMultiplier = 4;
    this.swipeDamageMultiplier = 2;
    this.turns = 1; // full rotations per swipe
    this.triggerMargin = 30; // px beyond weapon reach at which it's worth swinging

    this.rotated = 0;
  }

  get spinMultiplier() {
    return this.active ? this.swipeSpinMultiplier : 1;
  }

  get damageMultiplier() {
    return this.active ? this.swipeDamageMultiplier : 1;
  }

  shouldActivate(sim) {
    const enemy = this.nearestEnemy(sim);
    if (!enemy) return false;
    const { owner, weapon } = this;
    const reach = owner.radius + weapon.gap + weapon.length + enemy.radius + this.triggerMargin;
    return distance(owner.pos, enemy.pos) < reach;
  }

  onStart(sim) {
    this.rotated = 0;
    this.emit(sim, 'swipe', { shake: 2 });
  }

  onUpdate(dt, sim) {
    this.rotated += this.weapon.spinSpeed * this.swipeSpinMultiplier * dt;
    if (this.rotated >= TAU * this.turns) this.end(sim);
  }

  // Fading arc behind the blade.
  draw(ctx) {
    if (!this.active) return;
    const { owner, weapon } = this;
    const inner = owner.radius + weapon.gap;
    const midRadius = inner + weapon.length / 2;
    const sweep = Math.min(this.rotated, TRAIL_ARC);
    const slices = 8;

    ctx.save();
    ctx.lineWidth = weapon.length;
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < slices; i++) {
      const a0 = weapon.angle - weapon.spinDir * sweep * (i / slices);
      const a1 = weapon.angle - weapon.spinDir * sweep * ((i + 1) / slices);
      ctx.globalAlpha = 0.28 * (1 - i / slices);
      ctx.beginPath();
      ctx.arc(owner.pos.x, owner.pos.y, midRadius, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
    }
    ctx.restore();
  }
}
