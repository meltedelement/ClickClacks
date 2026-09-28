import { Weapon } from './Weapon.js';
import { ChargeDash } from '../abilities/ChargeDash.js';

// Slow and long. Grows longer with every hit, so it controls more of the arena over time.
export class Spear extends Weapon {
  static id = 'spear';
  static displayName = 'Spear';
  static hue = 210;

  constructor(owner) {
    super(owner);
    this.damage = 1;
    this.spinSpeed = 2.6;
    this.length = 110;
    this.thickness = 4;
    this.reachPerHit = 6; // px of length gained per hit
    this.damagePerHit = 0.5;
    this.ability = new ChargeDash(this);
  }

  onHit() {
    this.length += this.reachPerHit;
    this.damage += this.damagePerHit;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const headLength = 20;
    const shaftEnd = end - headLength;

    // Shaft
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(start, -2.5, shaftEnd - start, 5);

    // Binding where the head meets the shaft
    ctx.fillStyle = '#3d2a17';
    ctx.fillRect(shaftEnd - 6, -3.5, 6, 7);

    // Head
    ctx.fillStyle = '#c8d0d8';
    ctx.beginPath();
    ctx.moveTo(shaftEnd, -7);
    ctx.lineTo(end, 0);
    ctx.lineTo(shaftEnd, 7);
    ctx.closePath();
    ctx.fill();
  }
}
