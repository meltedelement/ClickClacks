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
    this.damage = 4;
    this.spinSpeed = 3.4;
    this.length = 80;
    this.thickness = 5;
    this.damagePerHit = 0.4;
    this.hilt = 'cross'; // 'cross' | 'swept' (the Piercer transformation's rapier)
    this.blade = 'straight'; // 'straight' | 'needle' (Piercer) | 'wavy' (Fire Eater)
    this.ability = new SpinSwipe(this);
    this.shields = [new Shield(this, { offset: SHIELD_OFFSET, width: 30 })];
  }

  onHit() {
    this.damage += this.damagePerHit;
  }

  drawLocal(ctx, start) {
    const end = start + this.length;
    const bladeStart = start + 16;

    // Grip
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(start, -3, 12, 6);

    if (this.hilt === 'swept') {
      drawSweptHilt(ctx, start);
    } else {
      // Crossguard
      ctx.fillStyle = '#c9a44c';
      ctx.fillRect(start + 11, -10, 5, 20);
    }

    if (this.blade === 'needle') drawNeedleBlade(ctx, bladeStart, end);
    else if (this.blade === 'wavy') drawWavyBlade(ctx, bladeStart, end);
    else drawStraightBlade(ctx, bladeStart, end);
  }
}

function drawStraightBlade(ctx, bladeStart, end) {
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

// A rapier's hilt: a round pommel, a cup over the hand, long quillons and a
// knuckle bow sweeping back to the pommel.
function drawSweptHilt(ctx, start) {
  ctx.fillStyle = '#c9a44c';
  ctx.strokeStyle = '#c9a44c';
  ctx.beginPath();
  ctx.arc(start - 1, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillRect(start + 12, -14, 3, 28);

  ctx.beginPath();
  ctx.arc(start + 11, 0, 9, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8f7231';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = '#c9a44c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(start + 13, -9);
  ctx.quadraticCurveTo(start + 5, -15, start, -4);
  ctx.stroke();
}

// A rapier's blade: long, narrow and tapering to a needle point.
function drawNeedleBlade(ctx, bladeStart, end) {
  ctx.fillStyle = '#e8eef5';
  ctx.beginPath();
  ctx.moveTo(bladeStart, -3);
  ctx.lineTo(end, 0);
  ctx.lineTo(bladeStart, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9aa7b4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bladeStart + 2, 0);
  ctx.lineTo(end - 8, 0);
  ctx.stroke();
}

// A flamberge: both edges ripple like a flame, in blackened steel with glowing edges.
function drawWavyBlade(ctx, bladeStart, end) {
  const waveEnd = end - 12;
  const wave = (x) => 2.2 * Math.sin((x - bladeStart) * 0.5);
  ctx.beginPath();
  ctx.moveTo(bladeStart, -5);
  for (let x = bladeStart; x <= waveEnd; x += 2) ctx.lineTo(x, -5.5 + wave(x));
  ctx.lineTo(end, 0);
  for (let x = waveEnd; x >= bladeStart; x -= 2) ctx.lineTo(x, 5.5 + wave(x));
  ctx.closePath();
  ctx.fillStyle = '#3b3438';
  ctx.fill();
  ctx.strokeStyle = '#ff8a3d';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bladeStart + 3, 0);
  ctx.lineTo(end - 14, 0);
  ctx.stroke();
}
