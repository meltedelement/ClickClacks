import { Upgrade } from './Upgrade.js';
import { TAU, scale } from '../sim/math.js';

// Small upgrades for the Daggers: parrying, spin scaling, and staying slippery.

export class QuickRecovery extends Upgrade {
  static id = 'quick-recovery';
  static displayName = 'Quick Recovery';
  static description = 'Your daggers can parry the same weapon again twice as soon (each copy halves what is left).';
  static weapons = ['daggers'];

  apply() {
    this.weapon.parryLock *= 0.5;
  }
}

export class Momentum extends Upgrade {
  static id = 'momentum';
  static displayName = 'Momentum';
  static description = 'Your daggers gain 50% more spin speed per hit.';
  static weapons = ['daggers'];

  apply() {
    this.base ??= this.weapon.spinPerHit;
    this.weapon.spinPerHit += this.base * 0.5;
  }
}

export class CloseQuarters extends Upgrade {
  static id = 'close-quarters';
  static displayName = 'Close Quarters';
  static description = 'Your hits knock enemies back 40% less, keeping them in reach (each copy cuts what is left).';
  static weapons = ['daggers'];

  get knockbackMultiplier() {
    return 0.6 ** this.stacks;
  }
}

// Dodges are rolled by the Simulation on every hit (see Ball.dodgeChance).
export class Evasion extends Upgrade {
  static id = 'dodge';
  static displayName = 'Evasion';
  static description = '+12% chance to dodge a hit completely.';
  static weapons = ['daggers'];
  static maxStacks = 5;

  apply() {
    this.owner.dodgeChance += 0.12;
  }
}

export class Rebound extends Upgrade {
  static id = 'rebound';
  static displayName = 'Rebound';
  static description = 'Bouncing off a wall makes you 40% faster for a moment.';
  static weapons = ['daggers'];

  constructor(weapon) {
    super(weapon);
    this.boost = 0.4; // fraction of normal speed added
    this.duration = 0.75; // s
    this.timer = 0;
    this.added = 0; // speed added for the current boost, taken off again when it runs out
  }

  onWallBounce() {
    const { owner } = this;
    // Another bounce while boosted just keeps the boost going.
    if (this.added === 0) {
      const boost = this.boost * this.stacks;
      this.added = owner.speed * boost;
      owner.speed += this.added;
      if (!this.weapon.controlsMovement) owner.vel = scale(owner.vel, 1 + boost);
    }
    this.timer = this.duration;
  }

  onUpdate(dt) {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.owner.speed -= this.added;
      this.added = 0;
    }
  }

  // Faint afterimages while boosted.
  drawUnder(ctx) {
    if (this.timer <= 0) return;
    const { owner } = this;
    const fade = this.timer / this.duration;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 3; i++) {
      const behind = scale(owner.vel, -0.02 * i);
      ctx.globalAlpha = 0.22 * fade * (1 - i / 4);
      ctx.beginPath();
      ctx.arc(owner.pos.x + behind.x, owner.pos.y + behind.y, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
