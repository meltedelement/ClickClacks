import { CONFIG } from '../config.js';
import { TAU, fromAngle, length } from './math.js';
import { formatNumber } from '../utils/format.js';

export class Ball {
  // `upgrades` are Upgrade classes, applied in order once the weapon is built.
  // A class listed more than once stacks onto the same instance. Transformations
  // go first, so the small upgrades build on the weapon they turned it into, and
  // within each group a lower `static order` goes first.
  // `name` (e.g. a team name) replaces the weapon's name on screen.
  // `arena` ({ width, height }) is the Simulation's, for code that has no sim to hand (drawing).
  constructor({ position, color, WeaponClass, upgrades = [], name = null, arena = CONFIG.arena }) {
    this.pos = { ...position };
    this.arena = arena;
    this.label = name;
    // Royale growth (see grow). Always 1 in a normal match.
    this.mass = 1;
    this.size = 1;
    this.power = 1; // multiplies damage dealt; see grow
    this.radius = CONFIG.ball.radius;
    this.speed = CONFIG.ball.speed;
    const heading = Math.random() * TAU;
    this.maxHp = CONFIG.ball.maxHp;
    this.armor = 0; // taken off every weapon hit, but a hit is never reduced below half
    this.dodgeChance = 0; // 0–1 chance a weapon hit misses completely
    this.color = color;
    this.alive = true;
    this.flash = 0; // seconds left of the white hit flash

    // Weapon -> seconds until that weapon may hit this ball again.
    this.hitCooldowns = new Map();
    // Timed effects on this ball, at most one of each class. See Status.js.
    this.statuses = [];

    this.weapon = new WeaponClass(this);
    const ordered = [...upgrades].sort((A, B) => B.transformation - A.transformation || A.order - B.order);
    for (const UpgradeClass of ordered) {
      let upgrade = this.weapon.upgrades.find((u) => u.constructor === UpgradeClass);
      if (!upgrade) {
        upgrade = new UpgradeClass(this.weapon);
        this.weapon.upgrades.push(upgrade);
      }
      upgrade.stacks += 1;
      upgrade.apply();
    }

    // Set last so upgrades to speed or maxHp count from the start.
    this.vel = fromAngle(heading, this.speed);
    this.hp = this.maxHp;
  }

  get name() {
    return this.label ?? this.weapon.name;
  }

  // Royale: this ball knocked out one of `mass` and takes it. Its size goes
  // to mass ** sizeExponent: the radius, blades and shields grow in proportion
  // (Weapon.scaleGeometry). Max HP and damage dealt follow size ** hpScaling
  // and size ** damageScaling; the max HP gained is healed. Returns the growth factor.
  grow(mass, { sizeExponent, hpScaling, damageScaling }) {
    const before = this.size;
    this.mass += mass;
    this.size = this.mass ** sizeExponent;
    const factor = this.size / before;
    this.radius *= factor;
    const gained = this.maxHp * (factor ** hpScaling - 1);
    this.maxHp += gained;
    if (this.alive) this.hp += gained;
    this.power = this.size ** damageScaling;
    this.weapon.registerGrow(factor);
    return factor;
  }

  // Runs `fn` with the ball's geometry shrunk back to size 1, so drawing code
  // can use the plain stats under a canvas scaled by `size` (see Weapon.draw).
  // Puts the exact values back afterwards, so the sim isn't changed.
  atUnitSize(fn) {
    const size = this.size;
    if (size === 1) return fn();
    const radius = this.radius;
    const saved = this.weapon.saveGeometry();
    this.radius = radius / size;
    this.weapon.scaleGeometry(1 / size);
    try {
      return fn();
    } finally {
      this.radius = radius;
      this.weapon.restoreGeometry(saved);
    }
  }

  update(dt, sim) {
    if (!this.weapon.controlsMovement) this.recoverSpeed(dt);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.weapon.update(dt, sim);

    if (this.statuses.length > 0) {
      for (const status of this.statuses) status.update(dt, sim);
      if (this.statuses.some((status) => status.expired)) {
        this.statuses = this.statuses.filter((status) => !status.expired);
      }
    }

    // Most steps there are none; skip making an iterator for an empty map.
    if (this.hitCooldowns.size > 0) {
      for (const [weapon, time] of this.hitCooldowns) {
        if (time - dt <= 0) this.hitCooldowns.delete(weapon);
        else this.hitCooldowns.set(weapon, time - dt);
      }
    }
    if (this.flash > 0) this.flash -= dt;
  }

  // Speed the ball tries to travel at right now, after statuses like slows.
  get cruiseSpeed() {
    return this.speed * this.statusMultiplier('speedMultiplier');
  }

  // Ease back towards cruising speed after being knocked around.
  recoverSpeed(dt) {
    const speed = this.cruiseSpeed;
    const current = length(this.vel);
    if (current < 1e-6) {
      this.vel = fromAngle(Math.random() * TAU, speed);
      return;
    }
    const t = Math.min(1, dt * CONFIG.ball.speedRecovery);
    const next = current + (speed - current) * t;
    // In place: this runs every step, and nothing holds on to a ball's old `vel`.
    const k = next / current;
    this.vel.x *= k;
    this.vel.y *= k;
  }

  // Puts a status on this ball, replacing any of the same class (so it refreshes).
  addStatus(status, sim) {
    this.statuses = this.statuses.filter((s) => s.constructor !== status.constructor);
    status.ball = this;
    this.statuses.push(status);
    status.onApply(sim);
  }

  hasStatus(StatusClass) {
    return this.statuses.some((s) => s instanceof StatusClass);
  }

  // True if any status stops this ball's weapon and shields from blocking.
  get guardBroken() {
    return this.statuses.some((status) => status.guardBroken);
  }

  // Multiplies all damage this ball deals: its statuses, and its size in a royale.
  get damageDealtMultiplier() {
    return this.statusMultiplier('damageDealtMultiplier') * this.power;
  }

  // This ball bounced off a wall: tell its upgrades and statuses.
  registerWallBounce(sim) {
    this.weapon.registerWallBounce(sim);
    for (const status of this.statuses) status.onWallBounce(sim);
  }

  // A status modifier multiplied across every status (1 if there are none).
  statusMultiplier(key) {
    let value = 1;
    for (const status of this.statuses) value *= status[key];
    return value;
  }

  // Lets `weapon` hit this ball again straight away (e.g. for rapid multi-hit moves).
  clearHitCooldown(weapon) {
    this.hitCooldowns.delete(weapon);
  }

  canBeHitBy(weapon) {
    return !this.hitCooldowns.has(weapon);
  }

  // Rolls this ball's dodge chance. Only uses Math.random when there is a chance
  // to dodge, so fights without dodging play out the same as before it existed.
  dodges() {
    return this.dodgeChance > 0 && Math.random() < this.dodgeChance;
  }

  // Damage actually taken from a weapon hit of `damage`, after armor and modifiers.
  reduceDamage(damage) {
    const armored = Math.max(damage / 2, damage - this.armor);
    return armored * this.weapon.damageTakenMultiplier * this.statusMultiplier('damageTakenMultiplier');
  }

  takeHit(weapon, damage) {
    this.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
    return this.takeDamage(damage);
  }

  // Removes HP. Returns how much was actually lost (no overkill).
  takeDamage(damage) {
    const lost = Math.min(this.hp, damage);
    this.hp -= lost;
    this.flash = 0.1;
    if (this.hp <= 0) this.alive = false;
    return lost;
  }

  // Restores HP up to maxHp. Returns how much was actually healed.
  heal(amount) {
    if (!this.alive) return 0;
    const healed = Math.min(this.maxHp - this.hp, amount);
    this.hp += healed;
    return healed;
  }

  draw(ctx) {
    const { x, y } = this.pos;
    const flashing = this.flash > 0;

    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, TAU);
    ctx.fillStyle = flashing ? '#ffffff' : this.color;
    ctx.fill();
    ctx.lineWidth = 3 * this.size;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
  }

  // The HP number on the ball: text and colour, drawn by the Renderer (which caches it).
  get hpText() {
    return formatNumber(this.hp);
  }

  get hpTextColor() {
    return this.flash > 0 ? this.color : '#ffffff';
  }
}
