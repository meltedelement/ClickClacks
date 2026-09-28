import { Upgrade } from './Upgrade.js';
import { ChargeDash } from '../abilities/ChargeDash.js';
import { TAU } from '../sim/math.js';

// Small upgrades for the Spear: its Charge Dash, its growth, and crits.

export class LongDash extends Upgrade {
  static id = 'long-dash';
  static displayName = 'Long Dash';
  static description = 'Charge Dash travels 40% further.';
  static weapons = ['spear'];

  apply() {
    if (!(this.ability instanceof ChargeDash)) return;
    this.base ??= this.ability.dashDuration;
    this.ability.dashDuration += this.base * 0.4;
  }
}

export class QuickCharge extends Upgrade {
  static id = 'quick-charge';
  static displayName = 'Quick Charge';
  static description = 'Charge Dash winds up twice as fast (each copy halves what is left).';
  static weapons = ['spear'];

  apply() {
    if (this.ability instanceof ChargeDash) this.ability.windup *= 0.5;
  }

  // A yellow pennant just behind the spear head.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - 26;
    ctx.save();
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(x, -2.5);
    ctx.lineTo(x - 16, -10);
    ctx.lineTo(x - 12, -2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export class DashGuard extends Upgrade {
  static id = 'dash-guard';
  static displayName = 'Braced';
  static description = 'Take 60% less damage while charging and dashing (each copy cuts what is left).';
  static weapons = ['spear'];

  get damageTakenMultiplier() {
    return this.ability?.active ? 0.4 ** this.stacks : 1;
  }

  // A pale bubble around the ball while the guard is up.
  drawOver(ctx) {
    if (!this.ability?.active) return;
    const { owner } = this;
    ctx.save();
    ctx.strokeStyle = '#9fd3ff';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

export class RapidGrowth extends Upgrade {
  static id = 'rapid-growth';
  static displayName = 'Rapid Growth';
  static description = 'Your spear grows 50% more with every hit.';
  static weapons = ['spear'];

  apply() {
    this.base ??= this.weapon.reachPerHit;
    this.weapon.reachPerHit += this.base * 0.5;
  }
}

export class DeadlyCrits extends Upgrade {
  static id = 'crit-damage';
  static displayName = 'Deadly Crits';
  static description = 'Critical hits deal +100% damage (triple instead of double).';
  static weapons = ['spear'];
  static requires = ['crit'];

  apply() {
    this.weapon.critMultiplier += 1;
  }
}
