import { Weapon } from './Weapon.js';
import { DropSlam } from '../abilities/DropSlam.js';
import { TAU } from '../sim/math.js';

const HEAD_RADIUS = 10;
const SPIKES = 7;

// Slow and heavy. Hits hard from the start, and a slam from high up hits very hard.
export class Mace extends Weapon {
  static id = 'mace';
  static displayName = 'Mace';
  static hue = 275;

  constructor(owner) {
    super(owner);
    this.damage = 5;
    this.spinSpeed = 2.4;
    this.length = 72;
    this.thickness = 7;
    this.damagePerHit = 0.4;
    this.head = 'mace'; // 'mace' | 'hammer' (the Metalworker transformation)
    this.ability = new DropSlam(this);
  }

  onHit() {
    this.damage += this.damagePerHit;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const headX = end - HEAD_RADIUS;

    // Handle
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(start, -3, headX - start, 6);

    if (this.head === 'hammer') {
      drawHammerHead(ctx, headX);
      return;
    }

    // Spikes
    ctx.fillStyle = '#8d949c';
    for (let i = 0; i < SPIKES; i++) {
      const a = (i / SPIKES) * TAU;
      const side = 0.35;
      ctx.beginPath();
      ctx.moveTo(headX + Math.cos(a - side) * HEAD_RADIUS, Math.sin(a - side) * HEAD_RADIUS);
      ctx.lineTo(headX + Math.cos(a) * (HEAD_RADIUS + 6), Math.sin(a) * (HEAD_RADIUS + 6));
      ctx.lineTo(headX + Math.cos(a + side) * HEAD_RADIUS, Math.sin(a + side) * HEAD_RADIUS);
      ctx.closePath();
      ctx.fill();
    }

    // Head
    ctx.fillStyle = '#b4bcc5';
    ctx.beginPath();
    ctx.arc(headX, 0, HEAD_RADIUS, 0, TAU);
    ctx.fill();
  }
}

// A smith's sledgehammer head: an iron block across the handle, with bright
// striking faces on both ends.
function drawHammerHead(ctx, headX) {
  ctx.fillStyle = '#6f7780';
  ctx.fillRect(headX - 8, -15, 16, 30);
  ctx.fillStyle = '#b4bcc5';
  ctx.fillRect(headX - 9, -18, 18, 5);
  ctx.fillRect(headX - 9, 13, 18, 5);
  ctx.strokeStyle = '#3f454c';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(headX - 8, -15, 16, 30);
}
