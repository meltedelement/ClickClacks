import { Upgrade } from './Upgrade.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { percent, formatNumber } from '../utils/format.js';

// Small upgrades for the Sword: its shield and its Spin Swipe.

const SHIELD_BASH = 1; // damage, per copy

export class ShieldBash extends Upgrade {
  static id = 'shield-bash';
  static displayName = 'Shield Bash';
  static describe(n) {
    return `When your shield blocks a blade, bullet or drone, hit back for ${SHIELD_BASH * n} damage.`;
  }
  static weapons = ['sword'];

  onBlock(attackerWeapon, sim) {
    const target = attackerWeapon.owner;
    if (!target.alive || sim.over) return;
    sim.applySecondaryHit(this.owner, target, SHIELD_BASH * this.stacks, { reason: 'bash', color: '#ffd966' });
  }
}

const SHIELD_SPIKES = 2; // contact damage, per copy

export class SpikedShield extends Upgrade {
  static id = 'shield-spikes';
  static displayName = 'Spiked Shield';
  static describe(n) {
    return `Your shield deals ${SHIELD_SPIKES * n} damage to enemies it touches.`;
  }
  static weapons = ['sword'];

  // The shield draws its own spikes once it has some.
  apply() {
    for (const shield of this.weapon.shields) {
      shield.contactDamage += SHIELD_SPIKES;
      shield.spikeLength = 7;
    }
  }
}

const BIG_SHIELD = 0.5; // more width, per copy

export class BigShield extends Upgrade {
  static id = 'big-shield';
  static displayName = 'Big Shield';
  static describe(n) {
    return `Your shield is ${percent(BIG_SHIELD * n)} wider.`;
  }
  static weapons = ['sword'];

  apply() {
    const { shields } = this.weapon;
    this.base ??= shields.map((shield) => shield.width);
    shields.forEach((shield, i) => (shield.width += this.base[i] * BIG_SHIELD));
  }
}

const WIDE_SWIPE = 0.4; // more length during Spin Swipe, per copy

export class WideSwipe extends Upgrade {
  static id = 'wide-swipe';
  static displayName = 'Wide Swipe';
  static describe(n) {
    return `Your sword is ${percent(WIDE_SWIPE * n)} longer during Spin Swipe, so it starts swiping from further away.`;
  }
  static weapons = ['sword'];

  // Spin Swipe starts once an enemy is in reach of the longer blade.
  apply() {
    if (this.ability instanceof SpinSwipe) this.ability.reachBonus += WIDE_SWIPE;
  }

  constructor(weapon) {
    super(weapon);
    this.added = 0; // px added for the current swipe, taken off again when it ends
  }

  onAbilityStart() {
    this.added = this.weapon.length * WIDE_SWIPE * this.stacks;
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

const LONG_SWIPE = 0.5; // extra turns, per copy

export class LongSwipe extends Upgrade {
  static id = 'long-swipe';
  static displayName = 'Long Swipe';
  static describe(n) {
    const turns = LONG_SWIPE * n;
    return turns === 0.5 ? 'Spin Swipe spins an extra half turn.' : `Spin Swipe spins ${formatNumber(turns)} extra turn${turns === 1 ? '' : 's'}.`;
  }
  static weapons = ['sword'];

  apply() {
    if (this.ability instanceof SpinSwipe) this.ability.turns += LONG_SWIPE;
  }
}
