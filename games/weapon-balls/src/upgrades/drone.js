import { Upgrade } from './Upgrade.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Drone: more drones, faster ones, a sturdier guard.

const QUICK_REPAIR = 0.7; // recovery times are multiplied by this, per copy

export class QuickRepair extends Upgrade {
  static id = 'quick-repair';
  static displayName = 'Quick Repair';
  static describe(n) {
    return `Knocked-away drones recover ${percent(1 - QUICK_REPAIR ** n)} faster.`;
  }
  static weapons = ['drone'];

  apply() {
    this.weapon.tumbleTime *= QUICK_REPAIR;
    this.weapon.recoverTime *= QUICK_REPAIR;
  }
}

const QUICK_PRODUCTION = 1; // more drones to start with and at most, per copy

export class QuickProduction extends Upgrade {
  static id = 'quick-production';
  static displayName = 'Quick Production';
  static describe(n) {
    const more = QUICK_PRODUCTION * n;
    return `Start with ${more} more drone${more === 1 ? '' : 's'}, and build up to ${more} more.`;
  }
  static weapons = ['drone'];

  apply() {
    this.weapon.blades += QUICK_PRODUCTION;
    this.weapon.maxDrones += QUICK_PRODUCTION;
  }
}

const DEFENSE_MATRIX_BLOCK = 1; // more damage blocked per guarding drone (1 = double), per copy
const DEFENSE_MATRIX_GUARD = 0.1; // more the guard can block in total, per copy

export class DefenseMatrix extends Upgrade {
  static id = 'defense-matrix';
  static displayName = 'Defense Matrix';
  static maxStacks = 3; // at 5 the guard could block whole hits
  static describe(n) {
    const times = 1 + DEFENSE_MATRIX_BLOCK * n;
    return `Guarding drones block ${times === 2 ? 'twice' : `${times} times`} as much damage, and the guard can block ${percent(DEFENSE_MATRIX_GUARD * n)} more in total.`;
  }
  static weapons = ['drone'];
  // Ace's drones tow instead of guarding.
  static excludedBy = ['ace'];

  apply() {
    this.base ??= this.weapon.guardPerDrone;
    this.weapon.guardPerDrone += this.base * DEFENSE_MATRIX_BLOCK;
    this.weapon.maxGuard += DEFENSE_MATRIX_GUARD;
  }
}

const BOOSTERS = 0.4; // more speed, per copy

export class Boosters extends Upgrade {
  static id = 'boosters';
  static displayName = 'Boosters';
  static describe(n) {
    return `Your drones fly ${percent(BOOSTERS * n)} faster.`;
  }
  static weapons = ['drone'];

  apply() {
    const { weapon } = this;
    this.base ??= { flySpeed: weapon.flySpeed, dashSpeed: weapon.dashSpeed, grip: weapon.grip, attackGrip: weapon.attackGrip, acceleration: weapon.acceleration };
    for (const key of Object.keys(this.base)) weapon[key] += this.base[key] * BOOSTERS;
  }

  // A glowing exhaust at the tail of each drone.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = '#6fd3ff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(start + this.weapon.length * 0.25, 0);
    ctx.lineTo(start - 5, -2.5);
    ctx.lineTo(start - 8, 0);
    ctx.lineTo(start - 5, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

const SPIKE_COLOR = '#c7ccd3';
const SPIKED_DRONES = 0.25; // damage, per copy

export class SpikedDrones extends Upgrade {
  static id = 'spiked-drones';
  static displayName = 'Spiked Drones';
  static describe(n) {
    return `Enemies take ${SPIKED_DRONES * n} damage when they knock one of your drones away.`;
  }
  static weapons = ['drone'];

  onDroneSwat(drone, enemy, point, sim) {
    sim.dealDamage(this.owner, enemy, SPIKED_DRONES * this.stacks, { reason: 'spikes', color: SPIKE_COLOR });
  }

  // Spikes off the back of each wing.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = SPIKE_COLOR;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(start + 2, side * 4);
      ctx.lineTo(start - 4, side * 10);
      ctx.lineTo(start + 6, side * 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
