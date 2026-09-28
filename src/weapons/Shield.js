import { TAU, add, fromAngle, sub } from '../sim/math.js';

// An off-hand shield: a curved plate just outside the ball that sits at a fixed
// angle from its weapon and turns with it. Enemy weapons that touch it are
// blocked. Give a weapon one with `this.shield = new Shield(this, { ... })`.
export class Shield {
  constructor(weapon, { offset, distance = 7, width = 40, thickness = 5 }) {
    this.weapon = weapon;
    this.offset = offset; // radians from the weapon; negative = to the weapon's left
    this.distance = distance; // px between the ball's surface and the shield
    this.width = width; // px across
    this.thickness = thickness; // hitbox half-width, px
  }

  get angle() {
    return this.weapon.angle + this.offset;
  }

  get radius() {
    return this.weapon.owner.radius + this.distance;
  }

  // Straight segment across the face of the shield, in arena coordinates.
  getSegment() {
    const center = add(this.weapon.owner.pos, fromAngle(this.angle, this.radius));
    const across = fromAngle(this.angle + Math.PI / 2, this.width / 2);
    return { a: sub(center, across), b: add(center, across) };
  }

  draw(ctx) {
    const { x, y } = this.weapon.owner.pos;
    const halfArc = this.width / 2 / this.radius;
    const from = this.angle - halfArc;
    const to = this.angle + halfArc;

    ctx.save();
    ctx.lineCap = 'round';

    // Metal rim
    ctx.strokeStyle = '#c3c9d1';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(x, y, this.radius, from, to);
    ctx.stroke();

    // Wooden face
    ctx.strokeStyle = '#8a6a3f';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(x, y, this.radius, from, to);
    ctx.stroke();

    // Boss in the middle
    const boss = add({ x, y }, fromAngle(this.angle, this.radius));
    ctx.fillStyle = '#c3c9d1';
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawHitbox(ctx) {
    const { a, b } = this.getSegment();
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 180, 255, 0.6)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}
