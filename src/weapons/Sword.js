import { Weapon } from './Weapon.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { Shield } from './Shield.js';

const SHIELD_OFFSET = -0.95; // radians: a bit to the left of the sword

// Fast, short, and snowballs hard: every hit makes the next one hurt more.
// Carries a shield just to the left of the sword that blocks enemy weapons.
export class Sword extends Weapon {
  static id = 'sword';
  static displayName = 'Sword';
  static hue = 0;

  constructor(owner) {
    super(owner);
    this.damage = 1;
    this.spinSpeed = 3.4;
    this.length = 80;
    this.thickness = 5;
    this.ability = new SpinSwipe(this);
    this.shields = [new Shield(this, { offset: SHIELD_OFFSET, width: 30 })];
  }

  onHit() {
    this.damage += 1;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const bladeStart = start + 16;

    // Grip
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(start, -3, 12, 6);

    // Crossguard
    ctx.fillStyle = '#c9a44c';
    ctx.fillRect(start + 11, -10, 5, 20);

    // Blade
    ctx.fillStyle = '#dfe6ee';
    ctx.beginPath();
    ctx.moveTo(bladeStart, -5);
    ctx.lineTo(end - 10, -5);
    ctx.lineTo(end, 0);
    ctx.lineTo(end - 10, 5);
    ctx.lineTo(bladeStart, 5);
    ctx.closePath();
    ctx.fill();

    // Fuller (groove down the middle)
    ctx.strokeStyle = '#9aa7b4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bladeStart + 3, 0);
    ctx.lineTo(end - 14, 0);
    ctx.stroke();
  }
}
