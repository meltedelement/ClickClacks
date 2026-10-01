import { Upgrade } from './Upgrade.js';

// Small upgrades for the Drone: more drones, faster ones, a sturdier guard.

export class QuickRepair extends Upgrade {
  static id = 'quick-repair';
  static displayName = 'Quick Repair';
  static description = 'Swatted drones tumble for 30% less time, and once back they can attack again 30% sooner (each copy cuts what is left).';
  static weapons = ['drone'];

  apply() {
    this.weapon.tumbleTime *= 0.7;
    this.weapon.recoverTime *= 0.7;
  }
}

export class QuickProduction extends Upgrade {
  static id = 'quick-production';
  static displayName = 'Quick Production';
  static description = 'Start with 1 more drone (and build up to 1 more).';
  static weapons = ['drone'];
  static maxStacks = 3;

  apply() {
    this.weapon.blades += 1;
    this.weapon.maxDrones += 1;
  }
}

export class DefenseMatrix extends Upgrade {
  static id = 'defense-matrix';
  static displayName = 'Defense Matrix';
  static description = 'Each guarding drone takes twice as much off a hit, and the guard can take off 10% more of it in all.';
  static weapons = ['drone'];
  static maxStacks = 3;
  // Ace's drones tow instead of guarding.
  static excludedBy = ['ace'];

  apply() {
    this.base ??= this.weapon.guardPerDrone;
    this.weapon.guardPerDrone += this.base;
    this.weapon.maxGuard += 0.1;
  }
}

export class Boosters extends Upgrade {
  static id = 'boosters';
  static displayName = 'Boosters';
  static description = 'Your drones fly 40% faster, attacking and catching up with the formation.';
  static weapons = ['drone'];

  apply() {
    const { weapon } = this;
    this.base ??= { flySpeed: weapon.flySpeed, dashSpeed: weapon.dashSpeed, grip: weapon.grip, attackGrip: weapon.attackGrip, acceleration: weapon.acceleration };
    for (const key of Object.keys(this.base)) weapon[key] += this.base[key] * 0.4;
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

export class SpikedDrones extends Upgrade {
  static id = 'spiked-drones';
  static displayName = 'Spiked Drones';
  static description = 'Whoever swats one of your drones takes 0.25 damage.';
  static weapons = ['drone'];

  constructor(weapon) {
    super(weapon);
    this.damage = 0.25;
  }

  onDroneSwat(drone, enemy, point, sim) {
    sim.dealDamage(this.owner, enemy, this.damage * this.stacks, { reason: 'spikes', color: SPIKE_COLOR });
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
