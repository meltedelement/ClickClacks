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
    this.damage = 2;
    this.spinSpeed = 4.2;
    this.length = 42;
    this.thickness = 3;
    this.blades = 2;
    this.spinPerHit = 0.3;
    this.damagePerHit = 0.04;
    this.parryLock = 0.5; // s a dagger can't re-parry the same weapon it just parried
    this.style = 'dagger'; // 'dagger' | 'hatchet' (the Axeman transformation)
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

  // Against other Daggers, a dagger that can't parry right now (drawn red)
  // swings through their blades instead of getting stuck on them. Otherwise
  // two sets of fast blades lock each other out of hitting until time runs out.
  clashesWith(otherWeapon) {
    return !(otherWeapon instanceof Daggers) || this.canParry(otherWeapon);
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
    if (this.style === 'hatchet') {
      drawHatchet(ctx, start, start + this.length, this.parryLocked);
      return;
    }
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

// A wooden handle with an iron head at the end: a curved bit on one side and a
// short poll on the other. Sized for Axeman's thicker hitbox.
function drawHatchet(ctx, start, end, locked) {
  // Handle
  ctx.fillStyle = '#7a5530';
  ctx.fillRect(start, -2.5, end - start - 3, 5);

  // Head
  ctx.fillStyle = '#6f7780';
  ctx.beginPath();
  ctx.moveTo(end - 16, -6);
  ctx.lineTo(end - 3, -6);
  ctx.lineTo(end - 3, 2);
  ctx.lineTo(end - 16, 2);
  ctx.closePath();
  ctx.fill();

  // Bit, with the cutting edge along the far side
  ctx.fillStyle = locked ? '#e8493f' : '#e3e8ee';
  ctx.beginPath();
  ctx.moveTo(end - 14, 2);
  ctx.lineTo(end - 5, 2);
  ctx.quadraticCurveTo(end + 1, 6, end + 1, 11);
  ctx.quadraticCurveTo(end - 9, 13, end - 18, 10);
  ctx.quadraticCurveTo(end - 13, 7, end - 14, 2);
  ctx.closePath();
  ctx.fill();
}
