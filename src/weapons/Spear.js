import { Weapon } from './Weapon.js';
import { ChargeDash } from '../abilities/ChargeDash.js';
import { distance } from '../sim/math.js';

// Slow and long. Grows longer with every hit, so it controls more of the arena over time.
export class Spear extends Weapon {
  static id = 'spear';
  static displayName = 'Spear';
  static hue = 210;

  constructor(owner) {
    super(owner);
    this.damage = 3;
    this.spinSpeed = 2.6;
    this.length = 110;
    this.thickness = 4;
    this.reachPerHit = 6; // px of length gained per hit
    this.damagePerHit = 0.2;
    this.headLength = 20; // px of point at the end of the shaft; see headHit()
    this.head = 'spear'; // 'spear' | 'trident' (the Poseidon transformation)
    this.ability = new ChargeDash(this);
  }

  onHit() {
    this.length += this.reachPerHit;
    this.damage += this.damagePerHit;
  }

  // True if a hit at `point` (on one of the blades) landed with the head rather than the shaft.
  headHit(point) {
    const tip = this.owner.radius + this.gap + this.length;
    return distance(point, this.owner.pos) >= tip - this.headLength;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const shaftEnd = end - this.headLength;

    // Shaft: sea-green for Poseidon's trident
    const trident = this.head === 'trident';
    ctx.fillStyle = trident ? '#2d6e73' : '#8b5a2b';
    ctx.fillRect(start, -2.5, shaftEnd - start, 5);

    // Binding where the head meets the shaft
    ctx.fillStyle = '#3d2a17';
    ctx.fillRect(shaftEnd - 6, -3.5, 6, 7);

    if (trident) {
      drawTridentHead(ctx, shaftEnd, end);
    } else {
      ctx.fillStyle = '#c8d0d8';
      drawSpearHead(ctx, shaftEnd, end);
    }
  }
}

function drawSpearHead(ctx, base, end) {
  ctx.beginPath();
  ctx.moveTo(base, -7);
  ctx.lineTo(end, 0);
  ctx.lineTo(base, 7);
  ctx.closePath();
  ctx.fill();
}

// A golden crossbar with two short barbed prongs either side of a big
// leaf-shaped centre blade.
function drawTridentHead(ctx, base, end) {
  const len = end - base;
  ctx.fillStyle = '#e8c04a';
  ctx.fillRect(base, -13, 5, 26);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(base + 2, side * 13);
    ctx.lineTo(base + len * 0.55, side * 11);
    ctx.lineTo(base + len * 0.45, side * 7);
    ctx.lineTo(base + 5, side * 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(base + 3, -3);
  ctx.quadraticCurveTo(base + len * 0.45, -10, end, 0);
  ctx.quadraticCurveTo(base + len * 0.45, 10, base + 3, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#a07a1c';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(base + 6, 0);
  ctx.lineTo(end - 8, 0);
  ctx.stroke();
}
