import { Upgrade } from './Upgrade.js';
import { DropSlam } from '../abilities/DropSlam.js';

// Small upgrades for the Mace, all about its Drop Slam.

export class QuickDrop extends Upgrade {
  static id = 'quick-drop';
  static displayName = 'Quick Drop';
  static description = 'Drop Slam gains 12.5% more damage from the height it falls.';
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= this.ability.damagePerPx;
    this.ability.damagePerPx += this.base * 0.125;
  }
}

export class HeavyImpact extends Upgrade {
  static id = 'heavy-impact';
  static displayName = 'Heavy Impact';
  static description = 'Drop Slam gains 50% more damage from the height it falls.';
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= this.ability.damagePerPx;
    this.ability.damagePerPx += this.base * 0.5;
  }
}

export class HighBounce extends Upgrade {
  static id = 'high-bounce';
  static displayName = 'High Bounce';
  static description =
    'Drop Slam bounces you back up off the floor at +100% speed, and every other bounce off the floor gets +50% speed upwards.';
  static weapons = ['mace'];

  constructor(weapon) {
    super(weapon);
    this.floorBoost = 0.5; // upward speed added by an ordinary floor bounce, as a fraction of the ball's speed
  }

  apply() {
    if (this.ability instanceof DropSlam) this.ability.landBounce += 1;
  }

  // Drop Slam's own landing isn't a wall bounce (it stops just short of the
  // floor), so this only catches ordinary bounces.
  onWallBounce(sim) {
    const { owner } = this;
    if (this.weapon.controlsMovement || owner.pos.y < sim.arena.height - owner.radius) return;
    owner.vel.y -= owner.speed * this.floorBoost * this.stacks;
  }
}

export class GreatMace extends Upgrade {
  static id = 'great-mace';
  static displayName = 'Great Mace';
  static description = 'Your mace is 40% longer during Drop Slam.';
  static weapons = ['mace'];

  constructor(weapon) {
    super(weapon);
    this.lengthBonus = 0.4;
    this.added = 0; // px added for the current slam, taken off again when it ends
  }

  onAbilityStart() {
    this.added = this.weapon.length * this.lengthBonus * this.stacks;
    this.weapon.length += this.added;
  }

  onAbilityEnd() {
    this.weapon.length -= this.added;
    this.added = 0;
  }

  onGrow(factor) {
    this.added *= factor;
  }
}

export class Meteor extends Upgrade {
  static id = 'meteor';
  static displayName = 'Meteor';
  static description = 'Drop Slam homes in on the enemy 25% better as it falls.';
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= this.ability.steerSpeed;
    this.ability.steerSpeed += this.base * 0.25;
  }
}
