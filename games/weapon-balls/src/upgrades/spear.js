import { Upgrade } from './Upgrade.js';
import { ChargeDash } from '../abilities/ChargeDash.js';
import { TAU } from '../sim/math.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Spear: its Charge Dash and its growth.

const PATIENT_CHARGE = 0.5; // longer windup, per copy (linear from the base windup)

// The windup is the Spear's best moment: it stands still with the spear levelled
// at the enemy, which tends to run onto the point, and those hits don't cancel
// the charge. So waiting longer is the upgrade (a shorter windup lost matches).
export class PatientCharge extends Upgrade {
  static id = 'patient-charge';
  static displayName = 'Patient Charge';
  static describe(n) {
    return `Charge Dash holds still and aims ${percent(PATIENT_CHARGE * n)} longer before it lunges.`;
  }
  static weapons = ['spear'];

  apply() {
    if (!(this.ability instanceof ChargeDash)) return;
    this.base ??= this.ability.windup;
    this.ability.windup += this.base * PATIENT_CHARGE;
  }

  // A yellow pennant just behind the spear head.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - this.weapon.headLength - 6;
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

const BRACED = 0.4; // damage taken while dashing is multiplied by this, per copy

export class DashGuard extends Upgrade {
  static id = 'dash-guard';
  static displayName = 'Braced';
  static describe(n) {
    return `Take ${percent(1 - BRACED ** n)} less damage while charging and dashing.`;
  }
  static weapons = ['spear'];

  get damageTakenMultiplier() {
    return this.ability?.active ? Math.pow(BRACED, this.stacks) : 1;
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

const RAPID_GROWTH = 0.5; // more growth per hit, per copy

export class RapidGrowth extends Upgrade {
  static id = 'rapid-growth';
  static displayName = 'Rapid Growth';
  static describe(n) {
    return `Your spear grows ${percent(RAPID_GROWTH * n)} more with each hit.`;
  }
  static weapons = ['spear'];

  apply() {
    this.base ??= this.weapon.reachPerHit;
    this.weapon.reachPerHit += this.base * RAPID_GROWTH;
  }
}
