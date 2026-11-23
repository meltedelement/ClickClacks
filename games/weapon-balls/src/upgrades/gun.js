import { Upgrade } from './Upgrade.js';
import { GuardBroken } from './spear-transformations.js';
import { TAU, add, fromAngle } from '../sim/math.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Gun: how fast and true it shoots, and what its
// bullets do. They work through the Gun's stats and its bullet hooks (see Gun.js).

// Shortens `weapon[key]`, a time between things, so that each copy adds
// `share` of the original rate: n copies give 1 + share × n times as many.
function quicken(upgrade, key, share) {
  const n = upgrade.stacks;
  upgrade.weapon[key] *= (1 + share * (n - 1)) / (1 + share * n);
}

const FIRE_RATE = 0.2; // more shots per second, per copy

export class FireRate extends Upgrade {
  static id = 'fire-rate';
  static displayName = 'Fire Rate';
  static describe(n) {
    return `Fire and reload ${percent(FIRE_RATE * n)} faster.`;
  }
  static weapons = ['gun'];

  apply() {
    quicken(this, 'fireInterval', FIRE_RATE);
    quicken(this, 'reloadTime', FIRE_RATE);
  }
}

const ACCURATE = 0.5; // spread is multiplied by this, per copy

export class Accurate extends Upgrade {
  static id = 'accurate';
  static displayName = 'Accurate';
  static describe(n) {
    return `Your shots are ${percent(1 - ACCURATE ** n)} more accurate.`;
  }
  static weapons = ['gun'];

  apply() {
    this.weapon.inaccuracy *= ACCURATE;
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

const MOTIVATED_BULLETS = 0.35; // more bullet speed, per copy

export class MotivatedBullets extends Upgrade {
  static id = 'motivated-bullets';
  static displayName = 'Motivated Bullets';
  static describe(n) {
    return `Your bullets fly ${percent(MOTIVATED_BULLETS * n)} faster.`;
  }
  static weapons = ['gun'];

  apply() {
    this.base ??= this.weapon.bulletSpeed;
    this.weapon.bulletSpeed += this.base * MOTIVATED_BULLETS;
  }
}

const GUARD_BREAK_COLOR = '#ff9f43';
const ANTI_MATERIEL = 1; // s of no blocking, per copy

export class AntiMateriel extends Upgrade {
  static id = 'anti-materiel';
  static displayName = 'Anti-materiel';
  static describe(n) {
    return `A bullet that hits an enemy's weapon, shield or drone stops them blocking for ${ANTI_MATERIEL * n}s.`;
  }
  static weapons = ['gun'];

  onBulletBlocked(bullet, enemy, point, sim) {
    if (!enemy.alive || sim.over) return;
    enemy.addStatus(new GuardBroken({ source: this.owner, duration: ANTI_MATERIEL * this.stacks }), sim);
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
const POP_POP = 0.1; // chance of a free bullet, per copy

export class PopPop extends Upgrade {
  static id = 'pop-pop';
  static displayName = 'Pop Pop';
  static describe(n) {
    return `${percent(POP_POP * n)} chance to fire a free extra bullet with each shot.`;
  }
  static weapons = ['gun'];

  onShot(sim) {
    if (Math.random() >= POP_POP * this.stacks) return;
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
