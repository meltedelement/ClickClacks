import { TAU, hypot, randomSign } from '../sim/math.js';
import { Ability } from '../abilities/Ability.js';
import { Upgrade } from '../upgrades/Upgrade.js';

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
    // Damage falloff with distance, for ranged weapons (Gun, Drone): hits landing within
    // `falloffStart` px of the ball's centre do full damage, fading linearly to
    // `falloffMin` x the damage at `falloffEnd` px and beyond. Off by default.
    this.falloffStart = Infinity;
    this.falloffEnd = Infinity;
    this.falloffMin = 1;
    this.lastHitCrit = false; // whether the hit being registered was a crit
    this.nudges = false; // true: a hit's knockback adds to the target's velocity instead of replacing it

    // Optional special move, e.g. `this.ability = new SpinSwipe(this)`. See src/abilities/.
    this.ability = null;
    // Off-hand shields that block enemy weapons, e.g. `this.shields = [new Shield(this, { ... })]`. See Shield.js.
    this.shields = [];
    // Burning ground the ability lays down, if an upgrade (Runner) gives it one.
    this.fireTrail = null;
    // Roguelike upgrades from the loadout, added by Ball after construction. See src/upgrades/.
    this.upgrades = [];
    this.overrideCache = null; // see overridesOf
    this.blockedRound = -1; // Simulation.resolveCombat's round this weapon was last blocked in
  }

  get name() {
    return this.constructor.displayName;
  }

  // Damage this weapon deals right now, including ability and upgrade bonuses.
  // Flat bonuses are added to the base first, then everything is multiplied.
  // With `point` (where a hit landed), upgrades that care where the blade
  // connected get a say too.
  getDamage(point) {
    let damage = (this.baseDamage + this.sum('bonusDamage')) * this.multiplier('damageMultiplier');
    if (point) {
      damage *= this.rangeMultiplier(point);
      for (const upgrade of this.upgradesWith('damageMultiplierAt')) damage *= upgrade.damageMultiplierAt(point);
    }
    return damage;
  }

  // 1 up close, fading to `falloffMin` the further from the ball a hit lands
  // (distances at size 1; a royale scales them with the ball).
  rangeMultiplier(point) {
    if (this.falloffStart === Infinity) return 1;
    const { owner } = this;
    const dist = hypot(point.x - owner.pos.x, point.y - owner.pos.y) / owner.size;
    if (dist <= this.falloffStart) return 1;
    const t = Math.min(1, (dist - this.falloffStart) / (this.falloffEnd - this.falloffStart));
    return 1 - (1 - this.falloffMin) * t;
  }

  // Rolls for a critical hit landing at `point`. Only uses Math.random when
  // there is a chance to crit and no upgrade guarantees one, so fights without
  // crits play out the same as before crits existed.
  rollCrit(point) {
    if (this.ability?.guaranteesCrit) return true;
    if (point) {
      for (const upgrade of this.upgradesWith('critsAt')) if (upgrade.critsAt(point)) return true;
    }
    return this.critChance > 0 && Math.random() < this.critChance;
  }

  // The weapon's own damage before upgrades: `damage`, plus anything the weapon
  // itself adds on top for now (the Daggers' stolen damage).
  get baseDamage() {
    return this.damage;
  }

  // Last say on a weapon hit's damage to this weapon's ball, after armor and
  // multipliers (the Daggers take off what they've stolen). Returns the damage.
  reduceIncoming(damage) {
    return damage;
  }

  get knockbackMultiplier() {
    return this.multiplier('knockbackMultiplier');
  }

  // Multiplies damage this weapon's ball takes from weapon hits.
  get damageTakenMultiplier() {
    return this.multiplier('damageTakenMultiplier');
  }

  // These four and spinMultiplier are asked for every step, so they read the
  // override table's fields directly (see overrideTable).
  get controlsMovement() {
    return anyOf(this, this.overrideTable().controlsMovement);
  }

  get unblockable() {
    return anyOf(this, this.overrideTable().unblockable);
  }

  get unstoppable() {
    return anyOf(this, this.overrideTable().unstoppable);
  }

  // True while the weapon is out of its ball's hands (e.g. thrown): its blades
  // don't exist, so they can't hit, clash or be drawn. Shields stay.
  get disarmed() {
    return anyOf(this, this.overrideTable().disarmed);
  }

  // How much faster than its spinSpeed the weapon turns right now (Swarm, a swipe...).
  get spinMultiplier() {
    return multiplierOf(this, this.overrideTable().spinMultiplier);
  }

  // How far beyond the ball's surface it sends bullets back (a Parry), or 0.
  get projectileReflectRadius() {
    return this.ability?.reflectRadius ?? 0;
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

  // Called when this weapon's ball bounces off a wall (before its upgrades hear of it).
  onWallBounce(sim) {}

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

  // Draw anything the weapon leaves lying in the arena, underneath the balls.
  drawUnder(ctx) {}

  // Draw the weapon pointing along +x, starting at x = `start`.
  // The canvas is already translated to the ball's centre and rotated.
  drawLocal(ctx, start) {
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(start, -this.thickness, this.length, this.thickness * 2);
  }

  // ---- Engine internals (subclasses usually leave these alone) ----------------

  update(dt, sim) {
    this.ability?.update(dt, sim);
    for (const upgrade of this.overrideTable().onUpdate.upgrades) upgrade.onUpdate(dt, sim);
    this.turn(dt, sim);

    const targetSpread = multiplierOf(this, this.overrideTable().bladeSpread);
    this.spread += (targetSpread - this.spread) * Math.min(1, SPREAD_RATE * dt);
    if (this.parryCooldown > 0) this.parryCooldown -= dt;
  }

  // Turns the weapon for one step: a steady spin. Override to aim instead (Gun).
  turn(dt, sim) {
    this.angle += this.spinSpeed * this.spinMultiplier * this.spinDir * dt;
  }

  registerHit(target, sim, damage, point) {
    this.ability?.onHit(target, sim);
    this.onHit(target, sim);
    for (const upgrade of this.upgradesWith('onHit')) upgrade.onHit(target, sim, damage, point);
  }

  registerParry(otherWeapon, sim) {
    this.ability?.onParry(otherWeapon, sim);
    this.onParry(otherWeapon, sim);
    for (const upgrade of this.upgradesWith('onParry')) upgrade.onParry(otherWeapon, sim);
  }

  // `scatters` is false for a hit that leaves a guard alone (see Drone).
  registerOwnerHit(attackerWeapon, sim, damage, scatters = true) {
    this.ability?.onOwnerHit(attackerWeapon, sim);
    for (const upgrade of this.upgradesWith('onOwnerHit')) upgrade.onOwnerHit(attackerWeapon, sim, damage);
  }

  // True if an upgrade cancels this hit on this weapon's ball completely. The
  // first upgrade that does uses itself up; the rest aren't asked.
  preventsHit(attackerWeapon, sim) {
    for (const upgrade of this.upgradesWith('preventHit')) if (upgrade.preventHit(attackerWeapon, sim)) return true;
    return false;
  }

  // True if the ability stops `damage` coming from ball `source` (a Parry). Asked
  // by the Simulation once the damage is worked out, for weapon hits and other damage.
  absorbsDamage(source, damage, sim) {
    return this.ability?.absorbDamage(source, damage, sim) ?? false;
  }

  // This weapon's shield stopped `attackerWeapon`.
  registerBlock(attackerWeapon, sim) {
    for (const upgrade of this.upgradesWith('onBlock')) upgrade.onBlock(attackerWeapon, sim);
  }

  // This weapon's ball bounced off a wall.
  registerWallBounce(sim) {
    this.onWallBounce(sim);
    for (const upgrade of this.upgradesWith('onWallBounce')) upgrade.onWallBounce(sim);
  }

  // This weapon's ball bumped into `other` ball (their bodies touched).
  registerBump(other, sim) {
    for (const upgrade of this.upgradesWith('onBump')) upgrade.onBump(other, sim);
  }

  // This weapon's ball grew by `factor` (royale): the blades and shields grow
  // with it, then the weapon and upgrades scale any other px they keep.
  registerGrow(factor) {
    this.scaleGeometry(factor);
    this.onGrow(factor);
    for (const upgrade of this.upgradesWith('onGrow')) upgrade.onGrow(factor);
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
    return multiplierOf(this, this.overridesOf(key));
  }

  // Like multiplier, but the upgrades' only, without the ability's: for hits
  // that don't come from the blades, which a swing doesn't power up.
  upgradeMultiplier(key) {
    const { upgrades, reads } = this.overridesOf(key);
    let value = 1;
    for (let i = 0; i < upgrades.length; i++) value *= reads[i].call(upgrades[i]);
    return value;
  }

  // A modifier added up across the ability and every upgrade (0 if none change it).
  sum(key) {
    const { abilityRead, upgrades, reads, skips } = this.overridesOf(key);
    let value = abilityRead === null ? 0 : abilityRead.call(this.ability) ?? 0;
    for (let i = 0; i < upgrades.length; i++) value += reads[i].call(upgrades[i]);
    // Adding the skipped upgrades' 0s would turn a -0 into 0; nothing else.
    return skips ? value + 0 : value;
  }

  // True if the ability or any upgrade turns this flag on.
  anyModifier(key) {
    return anyOf(this, this.overridesOf(key));
  }

  // The upgrades that override hook or modifier `key`, in order (don't modify the list).
  upgradesWith(key) {
    return this.overridesOf(key).upgrades;
  }

  // Which parts of this weapon can change modifier or hook `key`:
  // { abilityRead, upgrades, reads, skips }. `upgrades` lists, in order, only
  // the upgrades whose class overrides Upgrade's `key`, and `abilityRead` is
  // null if the ability's class leaves it as Ability has it. The defaults are
  // a multiplier of 1, a bonus of 0, a flag that's off and a hook that does
  // nothing, so skipping them changes no result, down to the bit. `skips` is
  // true if any upgrade was left out. `abilityRead` and `reads` (one per
  // upgrade) read the modifier: called on the ability or upgrade, they give
  // what `object[key]` would (usually they're its getter), without V8 looking
  // `key` up by name, which is slow with this many keys and classes.
  overridesOf(key) {
    const table = this.overrideTable();
    return table.entries.get(key) ?? this.addOverrides(table, key);
  }

  // Every overridesOf entry so far, for this weapon's current ability and
  // upgrades. The engine asks dozens of times a step and most upgrades change
  // only a few things, so they're worked out once: a weapon's ability and
  // upgrades only change while its ball is being built, and then this starts
  // afresh. The ones asked for every step are fields as well as in the Map,
  // as a field is quicker to read. Kept small so V8 inlines it.
  overrideTable() {
    const table = this.overrideCache;
    if (table !== null && table.count === this.upgrades.length && table.ability === this.ability) return table;
    return this.newOverrideTable();
  }

  newOverrideTable() {
    const table = { count: this.upgrades.length, ability: this.ability, entries: new Map() };
    this.overrideCache = table;
    table.spinMultiplier = this.addOverrides(table, 'spinMultiplier');
    table.bladeSpread = this.addOverrides(table, 'bladeSpread');
    table.controlsMovement = this.addOverrides(table, 'controlsMovement');
    table.unblockable = this.addOverrides(table, 'unblockable');
    table.unstoppable = this.addOverrides(table, 'unstoppable');
    table.disarmed = this.addOverrides(table, 'disarmed');
    table.onUpdate = this.addOverrides(table, 'onUpdate');
    return table;
  }

  addOverrides(table, key) {
    const upgrades = this.upgrades.filter((upgrade) => overrideOf(upgrade, key, Upgrade) !== null);
    const reads = upgrades.map((upgrade) => overrideOf(upgrade, key, Upgrade));
    const abilityRead = this.ability === null ? null : overrideOf(this.ability, key, Ability);
    const entry = { abilityRead, upgrades, reads, skips: upgrades.length < this.upgrades.length };
    table.entries.set(key, entry);
    return entry;
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
      this.drawLocal(ctx, unitStart, drone);
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

// A multiplier from a Weapon.overridesOf entry: the ability's times every upgrade's.
function multiplierOf(weapon, { abilityRead, upgrades, reads }) {
  let value = abilityRead === null ? 1 : abilityRead.call(weapon.ability) ?? 1;
  for (let i = 0; i < upgrades.length; i++) value *= reads[i].call(upgrades[i]);
  return value;
}

// A flag from a Weapon.overridesOf entry: on if the ability or any upgrade turns it on.
function anyOf(weapon, { abilityRead, upgrades, reads }) {
  if (abilityRead !== null && abilityRead.call(weapon.ability)) return true;
  for (let i = 0; i < upgrades.length; i++) if (reads[i].call(upgrades[i])) return true;
  return false;
}

// If `object` (an upgrade or an ability) has its own `key`, one its class or a
// class between it and `Base` defines rather than Base's default or nothing at
// all (an optional hook like the Drone's flyDrone), a function that reads it
// when called on `object`: its getter, or else one that reads it by name.
// Otherwise null. Worked out once per class; an own property on the object
// itself also counts.
const overrideMemo = new Map(); // class -> Map(key -> reader or null)

function overrideOf(object, key, Base) {
  if (Object.hasOwn(object, key)) return readerOf(object, key);
  let byKey = overrideMemo.get(object.constructor);
  if (byKey === undefined) overrideMemo.set(object.constructor, (byKey = new Map()));
  let reader = byKey.get(key);
  if (reader === undefined) {
    let holder = Object.getPrototypeOf(object);
    while (holder !== null && !Object.hasOwn(holder, key)) holder = Object.getPrototypeOf(holder);
    reader = holder !== null && holder !== Base.prototype ? readerOf(holder, key) : null;
    byKey.set(key, reader);
  }
  return reader;
}

function readerOf(holder, key) {
  const getter = Object.getOwnPropertyDescriptor(holder, key).get;
  return getter ?? function () {
    return this[key];
  };
}
