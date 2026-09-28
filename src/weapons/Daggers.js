import { Weapon } from './Weapon.js';
import { DashFlurry } from '../abilities/DashFlurry.js';

// Two short blades on opposite sides. Weak at first, but every hit makes them
// spin faster and cut a little deeper.
export class Daggers extends Weapon {
  static id = 'daggers';
  static displayName = 'Daggers';
  static hue = 140;

  constructor(owner) {
    super(owner);
    this.damage = 1;
    this.spinSpeed = 4.2;
    this.length = 42;
    this.thickness = 3;
    this.blades = 2;
    this.spinPerHit = 0.3;
    this.damagePerHit = 0.1;
    this.parryLock = 0.5; // s a dagger can't re-parry the same weapon it just parried
    this.ability = new DashFlurry(this);

    // Fast dual blades tend to clash with the same weapon over and over;
    // this tracks a short per-opponent cooldown on top of the shared one.
    this.parryLocks = new Map(); // weapon -> seconds left before it can be parried again
  }

  onHit() {
    this.spinSpeed += this.spinPerHit;
    this.damage += this.damagePerHit;
  }

  onParry(otherWeapon) {
    this.parryLocks.set(otherWeapon, this.parryLock);
  }

  canParry(otherWeapon) {
    return super.canParry(otherWeapon) && !this.parryLocks.has(otherWeapon);
  }

  update(dt, sim) {
    super.update(dt, sim);
    for (const [weapon, time] of this.parryLocks) {
      if (time - dt <= 0) this.parryLocks.delete(weapon);
      else this.parryLocks.set(weapon, time - dt);
    }
  }

  // True while this weapon can't parry anyone (shared cooldown or a per-opponent lock).
  get parryLocked() {
    return this.parryCooldown > 0 || this.parryLocks.size > 0;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const bladeStart = start + 12;

    // Grip
    ctx.fillStyle = '#2f2f36';
    ctx.fillRect(start, -2.5, 9, 5);

    // Guard
    ctx.fillStyle = '#9c8a5a';
    ctx.fillRect(start + 8, -6, 4, 12);

    // Blade
    ctx.fillStyle = this.parryLocked ? '#e8493f' : '#e3e8ee';
    ctx.beginPath();
    ctx.moveTo(bladeStart, -4);
    ctx.lineTo(end - 8, -3);
    ctx.lineTo(end, 0);
    ctx.lineTo(end - 8, 3);
    ctx.lineTo(bladeStart, 4);
    ctx.closePath();
    ctx.fill();
  }
}
