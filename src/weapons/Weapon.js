import { add, fromAngle, randomSign, TAU } from '../sim/math.js';

const GATHERED_GAP = 0.3; // radians between neighbouring blades when gathered together
const SPREAD_RATE = 14; // how quickly blades move between spread and gathered (per second)

// Base class for every weapon. A weapon is one or more straight blades that
// spin around their ball: each starts `gap` px outside the ball's surface and
// extends `length` px outward. Anything within `thickness` px of a blade
// counts as touching it. Multiple blades are spaced evenly around the ball.
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
    this.blades = 1; // copies of the weapon, evenly spaced around the ball
    this.spread = 1; // 1 = blades evenly spaced, 0 = gathered side by side at the front

    // Optional special move, e.g. `this.ability = new SpinSwipe(this)`. See src/abilities/.
    this.ability = null;
    // Optional off-hand shield that blocks enemy weapons. See Shield.js.
    this.shield = null;
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

  get unblockable() {
    return this.ability?.unblockable ?? false;
  }

  get unstoppable() {
    return this.ability?.unstoppable ?? false;
  }

  // ---- Hooks for subclasses -------------------------------------------------

  // Called after this weapon lands a hit (damage has already been dealt).
  // This is where scaling happens.
  onHit(target, sim) {}

  // Called when this weapon clashes with another weapon.
  onParry(otherWeapon, sim) {}

  // Whether this weapon is currently able to parry `otherWeapon`. Defaults to
  // the shared cooldown set on every parry; override to add per-opponent locks.
  canParry(otherWeapon) {
    return this.parryCooldown <= 0;
  }

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

    const targetSpread = this.ability?.bladeSpread ?? 1;
    this.spread += (targetSpread - this.spread) * Math.min(1, SPREAD_RATE * dt);
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

  // Angle of each blade. Spread out, blade 0 points along `this.angle`;
  // gathered, the blades fan either side of it.
  bladeAngles() {
    const n = this.blades;
    return Array.from({ length: n }, (_, i) => {
      const even = (i * TAU) / n;
      const gathered = (i - (n - 1) / 2) * GATHERED_GAP;
      return this.angle + gathered + (even - gathered) * this.spread;
    });
  }

  // One { a, b } segment per blade, from hilt to tip, in arena coordinates.
  getSegments() {
    const start = this.owner.radius + this.gap;
    return this.bladeAngles().map((angle) => ({
      a: add(this.owner.pos, fromAngle(angle, start)),
      b: add(this.owner.pos, fromAngle(angle, start + this.length)),
    }));
  }

  draw(ctx) {
    for (const angle of this.bladeAngles()) {
      ctx.save();
      ctx.translate(this.owner.pos.x, this.owner.pos.y);
      ctx.rotate(angle);
      this.drawLocal(ctx, this.owner.radius + this.gap);
      ctx.restore();
    }
    this.shield?.draw(ctx);
  }

  drawHitbox(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const { a, b } of this.getSegments()) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
    this.shield?.drawHitbox(ctx);
  }
}
