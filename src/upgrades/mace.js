import { Upgrade } from './Upgrade.js';
import { DropSlam } from '../abilities/DropSlam.js';

// Small upgrades for the Mace, all about its Drop Slam.

export class QuickDrop extends Upgrade {
  static id = 'quick-drop';
  static displayName = 'Quick Drop';
  static description = 'Drop Slam hangs in the air for 60% less time before falling (each copy cuts what is left).';
  static weapons = ['mace'];

  apply() {
    if (this.ability instanceof DropSlam) this.ability.hoverTime *= 0.4;
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
  static description = 'Drop Slam bounces you back up off the floor at +100% speed.';
  static weapons = ['mace'];

  apply() {
    if (this.ability instanceof DropSlam) this.ability.landBounce += 1;
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
}

export class Meteor extends Upgrade {
  static id = 'meteor';
  static displayName = 'Meteor';
  static description = 'Drop Slam starts falling faster and accelerates 50% harder.';
  static weapons = ['mace'];

  apply() {
    if (!(this.ability instanceof DropSlam)) return;
    this.base ??= { startSpeed: this.ability.startSpeed, gravity: this.ability.gravity };
    this.ability.startSpeed += this.base.startSpeed * 0.5;
    this.ability.gravity += this.base.gravity * 0.5;
  }
}
