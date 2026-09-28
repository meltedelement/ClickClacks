import { add, fromAngle, randomSign, TAU } from '../sim/math.js';

// Base class for every weapon. A weapon is a straight segment that spins
// around its ball: it starts `gap` px outside the ball's surface and extends
// `length` px outward. Anything within `thickness` px of that segment counts
// as touching it.
//
// To make a new weapon, extend this, set the static fields, tweak the stats in
// the constructor, and override the hooks you need (see Sword.js / Spear.js).
export class Weapon {
  static id = 'weapon'; // unique key used by the registry and UI
  static displayName = 'Weapon';
  static hue = 0; // ball colour, 0–360 on the colour wheel

  constructor(owner) {
    this.owner = owner;
    this.angle = Math.random() * TAU;
    this.spinDir = randomSign(); // 1 = clockwise, -1 = anticlockwise
    this.parryCooldown = 0;

    // Stats. Subclasses override these in their constructor.
    this.damage = 1;
    this.spinSpeed = 3; // radians per second
    this.length = 60; // px
    this.gap = 4; // px between the ball's surface and the start of the weapon
    this.thickness = 4; // hitbox half-width, px

    // Optional special move, e.g. `this.ability = new SpinSwipe(this)`. See src/abilities/.
    this.ability = null;
  }

  get name() {
    return this.constructor.displayName;
  }

  // Damage this weapon deals right now, including any ability bonus.
  getDamage() {
    return this.damage * (this.ability?.damageMultiplier ?? 1);
  }

  get knockbackMultiplier() {
    return this.ability?.knockbackMultiplier ?? 1;
  }

  get controlsMovement() {
    return this.ability?.controlsMovement ?? false;
  }

  // ---- Hooks for subclasses -------------------------------------------------

  // Called after this weapon lands a hit (damage has already been dealt).
  // This is where scaling happens.
  onHit(target, sim) {}

  // Called when this weapon clashes with another weapon.
  onParry(otherWeapon, sim) {}

  // Draw the weapon pointing along +x, starting at x = `start`.
  // The canvas is already translated to the ball's centre and rotated.
  drawLocal(ctx, start) {
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(start, -this.thickness, this.length, this.thickness * 2);
  }

  // ---- Engine internals (subclasses usually leave these alone) ----------------

  update(dt, sim) {
    this.ability?.update(dt, sim);
    const spinMultiplier = this.ability?.spinMultiplier ?? 1;
    this.angle += this.spinSpeed * spinMultiplier * this.spinDir * dt;
    if (this.parryCooldown > 0) this.parryCooldown -= dt;
  }

  registerHit(target, sim) {
    this.ability?.onHit(target, sim);
    this.onHit(target, sim);
  }

  registerParry(otherWeapon, sim) {
    this.ability?.onParry(otherWeapon, sim);
    this.onParry(otherWeapon, sim);
  }

  registerOwnerHit(attackerWeapon, sim) {
    this.ability?.onOwnerHit(attackerWeapon, sim);
  }

  getSegment() {
    const start = this.owner.radius + this.gap;
    return {
      a: add(this.owner.pos, fromAngle(this.angle, start)),
      b: add(this.owner.pos, fromAngle(this.angle, start + this.length)),
    };
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.owner.pos.x, this.owner.pos.y);
    ctx.rotate(this.angle);
    this.drawLocal(ctx, this.owner.radius + this.gap);
    ctx.restore();
  }

  drawHitbox(ctx) {
    const { a, b } = this.getSegment();
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}
