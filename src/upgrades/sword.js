import { Upgrade } from './Upgrade.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { add, fromAngle } from '../sim/math.js';

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

const SPIKES = 3;

export class SpikedShield extends Upgrade {
  static id = 'shield-spikes';
  static displayName = 'Spiked Shield';
  static description = 'Your shield deals 2 damage to enemies it touches.';
  static weapons = ['sword'];

  apply() {
    const { shield } = this.weapon;
    if (!shield) return;
    shield.contactDamage += 2;
    shield.spikeLength = 7;
  }

  // Spikes sticking out of the shield's face.
  drawOver(ctx) {
    const { shield } = this.weapon;
    if (!shield) return;
    const out = fromAngle(shield.angle, 1);
    const across = fromAngle(shield.angle + Math.PI / 2, 1);
    const face = add(this.owner.pos, fromAngle(shield.angle, shield.radius + 4));

    ctx.save();
    ctx.fillStyle = '#c3c9d1';
    for (let i = 0; i < SPIKES; i++) {
      const t = (i / (SPIKES - 1) - 0.5) * shield.width * 0.7;
      const base = add(face, { x: across.x * t, y: across.y * t });
      const tip = add(base, { x: out.x * (shield.spikeLength + 2), y: out.y * (shield.spikeLength + 2) });
      ctx.beginPath();
      ctx.moveTo(base.x + across.x * 3, base.y + across.y * 3);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(base.x - across.x * 3, base.y - across.y * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

export class BigShield extends Upgrade {
  static id = 'big-shield';
  static displayName = 'Big Shield';
  static description = 'Your shield is 50% wider.';
  static weapons = ['sword'];

  apply() {
    const { shield } = this.weapon;
    if (!shield) return;
    this.base ??= shield.width;
    shield.width += this.base * 0.5;
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
