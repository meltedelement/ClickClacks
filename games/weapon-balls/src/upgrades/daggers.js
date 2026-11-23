import { Upgrade } from './Upgrade.js';
import { TAU, scale } from '../sim/math.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Daggers: spin scaling, knockback and dodging.

const MOMENTUM = 0.5; // more spin per hit, per copy

export class Momentum extends Upgrade {
  static id = 'momentum';
  static displayName = 'Momentum';
  static describe(n) {
    return `Your dagger gains ${percent(MOMENTUM * n)} more spin speed with each hit.`;
  }
  static weapons = ['daggers'];

  apply() {
    this.base ??= this.weapon.spinPerHit;
    this.weapon.spinPerHit += this.base * MOMENTUM;
  }
}

const CLOSE_QUARTERS = 0.6; // knockback is multiplied by this, per copy

export class CloseQuarters extends Upgrade {
  static id = 'close-quarters';
  static displayName = 'Close Quarters';
  static describe(n) {
    return `Your hits knock enemies back ${percent(1 - CLOSE_QUARTERS ** n)} less, keeping them in reach.`;
  }
  static weapons = ['daggers'];

  get knockbackMultiplier() {
    return Math.pow(CLOSE_QUARTERS, this.stacks);
  }
}

const EVASION = 0.12; // dodge chance, per copy

// Dodges are rolled by the Simulation on every hit (see Ball.dodgeChance).
export class Evasion extends Upgrade {
  static id = 'dodge';
  static displayName = 'Evasion';
  static maxStacks = 5; // at 9 every hit would miss
  static describe(n) {
    return `+${percent(EVASION * n)} chance to dodge a hit.`;
  }
  static weapons = ['daggers'];

  apply() {
    this.owner.dodgeChance += EVASION;
  }
}
