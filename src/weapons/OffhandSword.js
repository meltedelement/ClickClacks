import { Shield } from './Shield.js';
import { add, fromAngle } from '../sim/math.js';

const LENGTH = 50; // px, vs. the Sword's 80
const DAMAGE = 3;

// A short second sword held in place of a shield (see the Dual Wielder
// upgrade). It's a Shield underneath, so it blocks enemy weapons and gets
// every shield upgrade, but it points straight out from the ball like a blade
// and always hurts enemy balls it touches. For an off-hand sword `width` is
// its length, so Big Shield makes it longer, and spikes make it serrated.
export class OffhandSword extends Shield {
  constructor(weapon, { offset, distance = 4, width = LENGTH, thickness = 4 }) {
    super(weapon, { offset, distance, width, thickness });
    this.contactDamage = DAMAGE;
    this.contactReason = 'offhand';
    this.contactColor = '#dfe6ee';
  }

  get reach() {
    return Math.max(Math.abs(this.radius), Math.abs(this.radius + this.width)) + this.thickness;
  }

  // From hilt to tip, pointing straight out from the ball.
  getSegment() {
    const { pos } = this.weapon.owner;
    return {
      a: add(pos, fromAngle(this.angle, this.radius)),
      b: add(pos, fromAngle(this.angle, this.radius + this.width)),
    };
  }

  draw(ctx) {
    if (this.away) return;
    const { x, y } = this.weapon.owner.pos;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angle);
    this.drawBlade(ctx, this.radius);
    ctx.restore();
  }

  // Same look as the Sword, scaled down. Drawn along +x from x = start.
  drawBlade(ctx, start) {
    const end = start + this.width;
    const bladeStart = start + 11;

    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(start, -2.5, 8, 5);
    ctx.fillStyle = '#c9a44c';
    ctx.fillRect(start + 7, -7, 4, 14);

    // Serrated edges when spiked, otherwise a plain blade.
    const teeth = this.spikeLength > 0 ? Math.max(3, Math.round((end - bladeStart) / 9)) : 0;
    ctx.fillStyle = '#dfe6ee';
    ctx.beginPath();
    ctx.moveTo(bladeStart, -4);
    for (let i = 1; i <= teeth; i++) {
      const tx = bladeStart + ((end - 8 - bladeStart) * (i - 0.5)) / teeth;
      ctx.lineTo(tx, -6.5);
      ctx.lineTo(tx + 3, -4);
    }
    ctx.lineTo(end - 8, -4);
    ctx.lineTo(end, 0);
    ctx.lineTo(end - 8, 4);
    for (let i = teeth; i >= 1; i--) {
      const tx = bladeStart + ((end - 8 - bladeStart) * (i - 0.5)) / teeth;
      ctx.lineTo(tx + 3, 4);
      ctx.lineTo(tx, 6.5);
    }
    ctx.lineTo(bladeStart, 4);
    ctx.closePath();
    ctx.fill();
  }

  // Cartwheeling end over end around its middle.
  drawThrown(ctx, pos, spin) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(spin);
    this.drawBlade(ctx, -this.width / 2);
    ctx.restore();
  }
}
