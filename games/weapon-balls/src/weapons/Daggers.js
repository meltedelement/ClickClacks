import { Weapon } from './Weapon.js';
import { Backstab } from '../abilities/Backstab.js';

// One dagger. It hits hard and crits harder, and every hit makes the next crit
// likelier and bigger (the plain damage never grows). Now and then it vanishes
// and reappears behind its opponent for a guaranteed crit (Backstab).
export class Daggers extends Weapon {
  static id = 'daggers';
  static displayName = 'Daggers';
  static hue = 140;

  constructor(owner) {
    super(owner);
    this.damage = 3.5;
    this.spinSpeed = 4.2;
    this.length = 42;
    this.thickness = 3;
    this.blades = 1;
    this.spinPerHit = 0.3;
    this.critChance = 0.15;
    this.critMultiplier = 3;
    this.critChancePerHit = 0.015;
    this.critMultiplierPerHit = 0.08;
    this.parryLock = 0.5; // s a dagger can't re-parry the same weapon it just parried
    this.style = 'dagger'; // 'dagger' | 'cutlass' (the Swashbuckler transformation)
    this.ability = new Backstab(this);

    // Fast blades tend to clash with the same weapon over and over;
    // this tracks a short per-opponent cooldown on top of the shared one.
    this.parryLocks = new Map(); // weapon -> seconds left before it can be parried again
  }

  onHit() {
    this.spinSpeed += this.spinPerHit;
    this.critChance = Math.min(1, this.critChance + this.critChancePerHit);
    this.critMultiplier += this.critMultiplierPerHit;
  }

  onParry(otherWeapon) {
    this.parryLocks.set(otherWeapon, this.parryLock);
  }

  canParry(otherWeapon) {
    return super.canParry(otherWeapon) && !this.parryLocks.has(otherWeapon);
  }

  // Against other Daggers, a dagger that can't parry right now (drawn red)
  // swings through their blades instead of getting stuck on them.
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
    if (this.style === 'cutlass') {
      drawCutlass(ctx, start, start + this.length, this.parryLocked);
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

// A cutlass: a basket guard and a broad blade curving towards its tip.
function drawCutlass(ctx, start, end, locked) {
  // Grip
  ctx.fillStyle = '#4a3320';
  ctx.fillRect(start, -2.5, 10, 5);

  // Basket guard
  ctx.strokeStyle = '#c9a43a';
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(201, 164, 58, 0.35)';
  ctx.beginPath();
  ctx.ellipse(start + 11, 0, 3.5, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Blade, curving to the sharp side
  const bladeStart = start + 14;
  ctx.fillStyle = locked ? '#e8493f' : '#e3e8ee';
  ctx.beginPath();
  ctx.moveTo(bladeStart, -4);
  ctx.quadraticCurveTo((bladeStart + end) / 2, -5, end - 4, -1);
  ctx.lineTo(end + 2, 3);
  ctx.quadraticCurveTo((bladeStart + end) / 2, 6, bladeStart, 4);
  ctx.closePath();
  ctx.fill();
}
