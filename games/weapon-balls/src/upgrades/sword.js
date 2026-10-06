import { Upgrade } from './Upgrade.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';

// Small upgrades for the Sword: its shield and its Spin Swipe.

export class ShieldBash extends Upgrade {
  static id = 'shield-bash';
  static displayName = 'Shield Bash';
  static description = 'Blocking a hit with your shield deals 1 damage back.';
  static weapons = ['sword'];

  constructor(weapon) {
    super(weapon);
    this.damage = 1;
  }

  onBlock(attackerWeapon, sim) {
    sim.dealDamage(this.owner, attackerWeapon.owner, this.damage * this.stacks, { reason: 'bash', color: '#ffd966' });
  }
}

export class SpikedShield extends Upgrade {
  static id = 'shield-spikes';
  static displayName = 'Spiked Shield';
  static description = 'Your shield deals 2 damage to enemies it touches.';
  static weapons = ['sword'];

  // The shield draws its own spikes once it has some.
  apply() {
    for (const shield of this.weapon.shields) {
      shield.contactDamage += 2;
      shield.spikeLength = 7;
    }
  }
}

export class BigShield extends Upgrade {
  static id = 'big-shield';
  static displayName = 'Big Shield';
  static description = 'Your shield is 50% wider.';
  static weapons = ['sword'];

  apply() {
    const { shields } = this.weapon;
    this.base ??= shields.map((shield) => shield.width);
    shields.forEach((shield, i) => (shield.width += this.base[i] * 0.5));
  }
}

export class WideSwipe extends Upgrade {
  static id = 'wide-swipe';
  static displayName = 'Wide Swipe';
  static description = 'Your sword is 40% longer during Spin Swipe.';
  static weapons = ['sword'];

  constructor(weapon) {
    super(weapon);
    this.lengthBonus = 0.4;
    this.added = 0; // px added for the current swipe, taken off again when it ends
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

export class LongSwipe extends Upgrade {
  static id = 'long-swipe';
  static displayName = 'Long Swipe';
  static description = 'Spin Swipe keeps spinning for an extra half turn.';
  static weapons = ['sword'];

  apply() {
    if (this.ability instanceof SpinSwipe) this.ability.turns += 0.5;
  }
}
