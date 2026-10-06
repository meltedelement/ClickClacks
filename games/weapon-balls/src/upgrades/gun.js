import { Upgrade } from './Upgrade.js';
import { GuardBroken } from './spear-transformations.js';
import { TAU, add, fromAngle } from '../sim/math.js';

// Small upgrades for the Gun: how fast and true it shoots, and what its
// bullets do. They work through the Gun's stats and its bullet hooks (see Gun.js).

// Shortens `weapon[key]`, a time between things, so that each copy adds
// `share` of the original rate: n copies give 1 + share × n times as many.
function quicken(upgrade, key, share) {
  const n = upgrade.stacks;
  upgrade.weapon[key] *= (1 + share * (n - 1)) / (1 + share * n);
}

export class FireRate extends Upgrade {
  static id = 'fire-rate';
  static displayName = 'Fire Rate';
  static description = 'You fire 20% faster, reloading included.';
  static weapons = ['gun'];

  apply() {
    quicken(this, 'fireInterval', 0.2);
    quicken(this, 'reloadTime', 0.2);
  }
}

export class Accurate extends Upgrade {
  static id = 'accurate';
  static displayName = 'Accurate';
  static description = 'Your shots stray half as far from where you aim (each copy halves what is left).';
  static weapons = ['gun'];
  static maxStacks = 3;

  apply() {
    this.weapon.inaccuracy *= 0.5;
  }

  // A scope on top of the gun.
  drawBlade(ctx, start) {
    const x = start + 6;
    ctx.save();
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(x + 3, -7, 2, 3);
    ctx.fillRect(x + 11, -7, 2, 3);
    ctx.fillRect(x, -11, 16, 4);
    ctx.fillStyle = '#6fd3ff';
    ctx.fillRect(x + 15, -10.5, 1.5, 3);
    ctx.restore();
  }
}

export class MotivatedBullets extends Upgrade {
  static id = 'motivated-bullets';
  static displayName = 'Motivated Bullets';
  static description = 'Your bullets fly 35% faster.';
  static weapons = ['gun'];

  apply() {
    this.base ??= this.weapon.bulletSpeed;
    this.weapon.bulletSpeed += this.base * 0.35;
  }
}

const GUARD_BREAK_COLOR = '#ff9f43';

export class AntiMateriel extends Upgrade {
  static id = 'anti-materiel';
  static displayName = 'Anti-materiel';
  static description = "A bullet that hits an enemy's weapon or shield breaks their guard for 1 s: their weapon and shields can't block.";
  static weapons = ['gun'];
  static maxStacks = 3;

  constructor(weapon) {
    super(weapon);
    this.duration = 1; // s per copy
  }

  onBulletBlocked(bullet, enemy, point, sim) {
    if (!enemy.alive || sim.over) return;
    enemy.addStatus(new GuardBroken({ source: this.owner, duration: this.duration * this.stacks }), sim);
    this.emit(sim, 'tackle', { pos: enemy.pos, text: 'GUARD BROKEN', color: GUARD_BREAK_COLOR, burst: { color: GUARD_BREAK_COLOR, count: 8, speed: 180, life: 0.3 } });
  }

  // A muzzle brake on the end of the barrel.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length;
    ctx.save();
    ctx.fillStyle = '#3f444b';
    ctx.fillRect(x - 6, -4, 8, 8);
    ctx.fillStyle = '#1c1e21';
    ctx.fillRect(x - 4.5, -4, 1.5, 8);
    ctx.fillRect(x - 1.5, -4, 1.5, 8);
    ctx.restore();
  }
}

const POP_COLOR = '#ffe066';

export class PopPop extends Upgrade {
  static id = 'pop-pop';
  static displayName = 'Pop Pop';
  static description = 'Each round you fire has a 10% chance to fire a second bullet with it, for free.';
  static weapons = ['gun'];
  static maxStacks = 5;

  constructor(weapon) {
    super(weapon);
    this.chance = 0.1; // per copy
  }

  onShot(sim) {
    if (Math.random() >= this.chance * this.stacks) return;
    const { weapon, owner } = this;
    weapon.shoot(weapon.stray(), sim);
    const pos = add(owner.pos, fromAngle(weapon.angle, owner.radius + weapon.gap + weapon.length));
    this.emit(sim, 'pop', { pos, burst: { color: POP_COLOR, count: 4, speed: 160, life: 0.2, size: 2 } });
  }

  // A second, smaller barrel slung under the first.
  drawBlade(ctx, start) {
    const { weapon } = this;
    if (weapon.model === 'smg') return; // the magazine is in the way
    ctx.save();
    ctx.fillStyle = '#6f7780';
    ctx.fillRect(start + 18, 3, weapon.length - 22, 2.5);
    ctx.fillStyle = POP_COLOR;
    ctx.beginPath();
    ctx.arc(start + weapon.length - 4, 4.25, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
