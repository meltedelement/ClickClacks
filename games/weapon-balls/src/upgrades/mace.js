import { Upgrade } from './Upgrade.js';
import { DropSlam } from '../abilities/DropSlam.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Mace, all about its Drop Slam.

// Damage comes from how far the slam falls, not how fast, so a slower fall
// hits just as hard and has longer to steer onto the enemy.
const SLOW_DROP = 0.8; // the fall's gravity and start speed are multiplied by this, per copy

export class SlowDrop extends Upgrade {
  static id = 'slow-drop';
  static displayName = 'Slow Drop';
  static maxStacks = 3; // a slam that takes too long to land gives up (DropSlam's MAX_DROP_TIME)
  static describe(n) {
    return `Drop Slam falls ${percent(1 - SLOW_DROP ** n)} slower, so it lines up better. It hits just as hard.`;
  }
  static weapons = ['mace'];

  apply() {
    const { ability } = this;
    if (!(ability instanceof DropSlam)) return;
    ability.gravity *= SLOW_DROP;
    ability.startSpeed *= SLOW_DROP;
  }
}

const HEAVY_IMPACT = 0.5; // more damage per px fallen, per copy

export class HeavyImpact extends Upgrade {
  static id = 'heavy-impact';
  static displayName = 'Heavy Impact';
  static describe(n) {
    return `Drop Slam gets ${percent(HEAVY_IMPACT * n)} more bonus damage from the height it falls.`;
  }
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= this.ability.damagePerPx;
    this.ability.damagePerPx += this.base * HEAVY_IMPACT;
  }
}

export class HighBounce extends Upgrade {
  static id = 'high-bounce';
  static displayName = 'High Bounce';
  static description = 'Bounce higher after a Drop Slam and off the floor, so you get back up to slam sooner.';
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

const GREAT_MACE = 0.4; // more length during Drop Slam, per copy

export class GreatMace extends Upgrade {
  static id = 'great-mace';
  static displayName = 'Great Mace';
  static describe(n) {
    return `Your mace is ${percent(GREAT_MACE * n)} longer during Drop Slam.`;
  }
  static weapons = ['mace'];

  constructor(weapon) {
    super(weapon);
    this.added = 0; // px added for the current slam, taken off again when it ends
  }

  onAbilityStart() {
    this.added = this.weapon.length * GREAT_MACE * this.stacks;
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

const METEOR = 0.25; // more steering speed, per copy

export class Meteor extends Upgrade {
  static id = 'meteor';
  static displayName = 'Meteor';
  static describe(n) {
    return `Drop Slam steers onto the enemy ${percent(METEOR * n)} faster.`;
  }
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= this.ability.steerSpeed;
    this.ability.steerSpeed += this.base * METEOR;
  }
}
