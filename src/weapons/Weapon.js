import { randomSign, TAU } from '../sim/math.js';

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
    this.widthScale = 1; // stretches drawLocal across the blade; set it when changing thickness
    this.critChance = 0; // 0–1 chance a hit is a critical hit
    this.critMultiplier = 2; // damage multiplier on a critical hit
    this.nudges = false; // true: a hit's knockback adds to the target's velocity instead of replacing it

    // Optional special move, e.g. `this.ability = new SpinSwipe(this)`. See src/abilities/.
    this.ability = null;
    // Off-hand shields that block enemy weapons, e.g. `this.shields = [new Shield(this, { ... })]`. See Shield.js.
    this.shields = [];
    // Burning ground the ability lays down, if an upgrade (Runner) gives it one.
    this.fireTrail = null;
    // Roguelike upgrades from the loadout, added by Ball after construction. See src/upgrades/.
    this.upgrades = [];
  }

  get name() {
    return this.constructor.displayName;
  }

  // Damage this weapon deals right now, including ability and upgrade bonuses.
  // Flat bonuses are added to the base first, then everything is multiplied.
  // With `point` (where a hit landed), upgrades that care where the blade
  // connected get a say too.
  getDamage(point) {
    let damage = (this.damage + this.sum('bonusDamage')) * this.multiplier('damageMultiplier');
    if (point) for (const upgrade of this.upgrades) damage *= upgrade.damageMultiplierAt(point);
    return damage;
  }

  // Rolls for a critical hit landing at `point`. Only uses Math.random when
  // there is a chance to crit and no upgrade guarantees one, so fights without
  // crits play out the same as before crits existed.
  rollCrit(point) {
    if (point && this.upgrades.some((upgrade) => upgrade.critsAt(point))) return true;
    return this.critChance > 0 && Math.random() < this.critChance;
  }

  get knockbackMultiplier() {
    return this.multiplier('knockbackMultiplier');
  }

  // Multiplies damage this weapon's ball takes from weapon hits.
  get damageTakenMultiplier() {
    return this.multiplier('damageTakenMultiplier');
  }

  get controlsMovement() {
    return this.anyModifier('controlsMovement');
  }

  get unblockable() {
    return this.anyModifier('unblockable');
  }

  get unstoppable() {
    return this.anyModifier('unstoppable');
  }

  // True while the weapon is out of its ball's hands (e.g. thrown): its blades
  // don't exist, so they can't hit, clash or be drawn. Shields stay.
  get disarmed() {
    return this.anyModifier('disarmed');
  }

  // How far from the ball's centre any blade's hitbox can reach (thickness
  // included). An upper bound for skipping collision tests between weapons too
  // far apart to touch (see Simulation.resolveCombat), so it ignores `disarmed`.
  // A weapon that overrides getSegments must override this to match.
  get bladeReach() {
    const start = this.owner.radius + this.gap;
    return Math.max(Math.abs(start), Math.abs(start + this.length)) + this.thickness;
  }

  // Like bladeReach, but covering the shields too (thrown ones included).
  get guardReach() {
    let reach = this.bladeReach;
    for (const shield of this.shields) reach = Math.max(reach, shield.reach);
    return reach;
  }

  // Shields in hand right now; a thrown one can't block or hurt anything until it's back.
  // Usually that's all of them, and then this is `shields` itself: don't modify it.
  get heldShields() {
    for (const shield of this.shields) if (shield.away) return this.shields.filter((s) => !s.away);
    return this.shields;
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

  // Whether this weapon is stopped by touching `otherWeapon` right now. If
  // not, it swings straight through: no parry, and it can still hit, but the
  // other weapon is blocked as usual. Shields still stop it.
  clashesWith(otherWeapon) {
    return true;
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
    for (const upgrade of this.upgrades) upgrade.onUpdate(dt, sim);
    const spinMultiplier = this.multiplier('spinMultiplier');
    this.angle += this.spinSpeed * spinMultiplier * this.spinDir * dt;

    const targetSpread = this.multiplier('bladeSpread');
    this.spread += (targetSpread - this.spread) * Math.min(1, SPREAD_RATE * dt);
    if (this.parryCooldown > 0) this.parryCooldown -= dt;
  }

  registerHit(target, sim, damage, point) {
    this.ability?.onHit(target, sim);
    this.onHit(target, sim);
    for (const upgrade of this.upgrades) upgrade.onHit(target, sim, damage, point);
  }

  registerParry(otherWeapon, sim) {
    this.ability?.onParry(otherWeapon, sim);
    this.onParry(otherWeapon, sim);
    for (const upgrade of this.upgrades) upgrade.onParry(otherWeapon, sim);
  }

  registerOwnerHit(attackerWeapon, sim, damage) {
    this.ability?.onOwnerHit(attackerWeapon, sim);
    for (const upgrade of this.upgrades) upgrade.onOwnerHit(attackerWeapon, sim, damage);
  }

  // True if an upgrade cancels this hit on this weapon's ball completely. The
  // first upgrade that does uses itself up; the rest aren't asked.
  preventsHit(attackerWeapon, sim) {
    return this.upgrades.some((upgrade) => upgrade.preventHit(attackerWeapon, sim));
  }

  // This weapon's shield stopped `attackerWeapon`.
  registerBlock(attackerWeapon, sim) {
    for (const upgrade of this.upgrades) upgrade.onBlock(attackerWeapon, sim);
  }

  // This weapon's ball bounced off a wall.
  registerWallBounce(sim) {
    for (const upgrade of this.upgrades) upgrade.onWallBounce(sim);
  }

  // This weapon's ball bumped into `other` ball (their bodies touched).
  registerBump(other, sim) {
    for (const upgrade of this.upgrades) upgrade.onBump(other, sim);
  }

  // This weapon's ball grew by `factor` (royale): the blades and shields grow
  // with it, then the weapon and upgrades scale any other px they keep.
  registerGrow(factor) {
    this.scaleGeometry(factor);
    this.onGrow(factor);
    for (const upgrade of this.upgrades) upgrade.onGrow(factor);
  }

  onGrow(factor) {}

  // Multiplies the blade and shield geometry by `factor` (see Ball.atUnitSize).
  scaleGeometry(factor) {
    this.length *= factor;
    this.gap *= factor;
    this.thickness *= factor;
    for (const shield of this.shields) shield.scaleGeometry(factor);
  }

  // The geometry scaleGeometry changes, to put back exactly with restoreGeometry.
  saveGeometry() {
    return { length: this.length, gap: this.gap, thickness: this.thickness, shields: this.shields.map((shield) => shield.saveGeometry()) };
  }

  restoreGeometry(saved) {
    this.length = saved.length;
    this.gap = saved.gap;
    this.thickness = saved.thickness;
    this.shields.forEach((shield, i) => shield.restoreGeometry(saved.shields[i]));
  }

  // A modifier multiplied across the ability and every upgrade (1 if none change it).
  multiplier(key) {
    let value = this.ability?.[key] ?? 1;
    for (const upgrade of this.upgrades) value *= upgrade[key];
    return value;
  }

  // A modifier added up across the ability and every upgrade (0 if none change it).
  sum(key) {
    let value = this.ability?.[key] ?? 0;
    for (const upgrade of this.upgrades) value += upgrade[key];
    return value;
  }

  // True if the ability or any upgrade turns this flag on.
  anyModifier(key) {
    if (this.ability?.[key]) return true;
    for (const upgrade of this.upgrades) if (upgrade[key]) return true;
    return false;
  }

  // Angle of each blade. Spread out, blade 0 points along `this.angle`;
  // gathered, the blades fan either side of it.
  // Plain loops here and in getSegments: they run several times per blade per
  // step, and Array.from/map with a callback is several times slower in V8.
  bladeAngles() {
    const n = this.blades;
    const count = Math.max(0, Math.floor(n)) || 0; // what Array.from({ length: n }) would give
    const angles = new Array(count);
    for (let i = 0; i < count; i++) {
      const even = (i * TAU) / n;
      const gathered = (i - (n - 1) / 2) * GATHERED_GAP;
      angles[i] = this.angle + gathered + (even - gathered) * this.spread;
    }
    return angles;
  }

  // One { a, b } segment per blade, from hilt to tip, in arena coordinates.
  getSegments() {
    if (this.disarmed) return [];
    const { x, y } = this.owner.pos;
    const start = this.owner.radius + this.gap;
    const end = start + this.length;
    const angles = this.bladeAngles();
    const segments = new Array(angles.length);
    for (let i = 0; i < angles.length; i++) {
      const cos = Math.cos(angles[i]);
      const sin = Math.sin(angles[i]);
      segments[i] = { a: { x: x + cos * start, y: y + sin * start }, b: { x: x + cos * end, y: y + sin * end } };
    }
    return segments;
  }

  // A grown ball's weapon is drawn at size 1 under a canvas scaled up around
  // the ball, so every drawing keeps its proportions.
  draw(ctx) {
    const { owner } = this;
    const { x, y } = owner.pos;
    const size = owner.size;
    if (size !== 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size, size);
      ctx.translate(-x, -y);
    }
    owner.atUnitSize(() => {
      for (const angle of this.disarmed ? [] : this.bladeAngles()) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(1, this.widthScale);
        const start = owner.radius + this.gap;
        this.drawLocal(ctx, start);
        for (const upgrade of this.upgrades) upgrade.drawBlade(ctx, start);
        ctx.restore();
      }
      for (const shield of this.shields) shield.draw(ctx);
    });
    if (size !== 1) ctx.restore();
  }

  // One blade (drawLocal plus the upgrades' drawBlade) drawn away from its
  // ball (thrown, flying...), with the canvas already moved to the blade.
  // Scaled to the ball's size like draw does; `start` is in arena units.
  // `drone` is passed on to drawBlade, for the Drone's upgrades.
  drawBladeAt(ctx, start, drone) {
    const size = this.owner.size;
    if (size !== 1) {
      ctx.save();
      ctx.scale(size, size);
    }
    this.owner.atUnitSize(() => {
      const unitStart = start / size;
      this.drawLocal(ctx, unitStart);
      for (const upgrade of this.upgrades) upgrade.drawBlade(ctx, unitStart, drone);
    });
    if (size !== 1) ctx.restore();
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
    for (const shield of this.shields) shield.drawHitbox(ctx);
  }
}
