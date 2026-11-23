import { CONFIG } from '../config.js';
import { TAU, fromAngle, length } from './math.js';
import { formatNumber } from '../utils/format.js';

export class Ball {
  // `upgrades` are Upgrade classes, applied in order once the weapon is built.
  // A class listed more than once stacks onto the same instance. Transformations
  // go first, so the small upgrades build on the weapon they turned it into, and
  // within each group a lower `static order` goes first.
  // `name` (e.g. a team name) replaces the weapon's name on screen.
  // `highlight` rings the ball, to pick it out of a crowd (see Renderer).
  // `skin` changes only how it's drawn (src/game/skins.js), and `tag` goes before
  // the name on screen ("DEV · Ana"). Neither touches the fight.
  // `size` is the starting size in a royale, in place of 1 (see grow).
  // `arena` ({ width, height }) is the Simulation's, for code that has no sim to hand (drawing).
  constructor({ position, color, WeaponClass, upgrades = [], name = null, highlight = false, skin = null, tag = null, size = 1, arena = CONFIG.arena }) {
    this.pos = { ...position };
    this.arena = arena;
    this.label = name;
    this.highlight = highlight;
    this.skin = skin;
    this.tag = tag;
    // Royale growth (see grow). Always 1 in a normal match.
    this.mass = 1;
    this.size = 1;
    this.power = 1; // multiplies damage dealt; see grow
    this.radius = CONFIG.ball.radius;
    this.speed = CONFIG.ball.speed;
    const heading = Math.random() * TAU;
    this.maxHp = CONFIG.ball.maxHp;
    this.dodgeChance = 0; // 0–1 chance a weapon hit misses completely
    this.color = color;
    this.alive = true;
    this.knockedOutAt = null; // sim time it went down (see Simulation.knockOut)
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

    // Starting another size is having already grown (or shrunk) to it, so everything
    // that scales with size starts in proportion, and a kill hands over this mass.
    if (size !== 1) this.grow(Math.pow(size, 1 / CONFIG.royale.sizeExponent) - 1, CONFIG.royale);
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
    this.size = Math.pow(this.mass, sizeExponent);
    const factor = this.size / before;
    this.radius *= factor;
    const gained = this.maxHp * (Math.pow(factor, hpScaling) - 1);
    this.maxHp += gained;
    if (this.alive) this.hp += gained;
    this.power = Math.pow(this.size, damageScaling);
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
      if (this.hasExpiredStatus()) this.statuses = this.statuses.filter((status) => !status.expired);
    }

    // Most steps there are none; skip making an iterator for an empty map.
    if (this.hitCooldowns.size > 0) this.hitCooldowns.forEach(countDown, dt);
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

  // These loop rather than call some() with a callback: they're asked several times a step.
  hasStatus(StatusClass) {
    for (const status of this.statuses) if (status instanceof StatusClass) return true;
    return false;
  }

  hasExpiredStatus() {
    for (const status of this.statuses) if (status.expired) return true;
    return false;
  }

  // True if any status stops this ball's weapon and shields from blocking.
  get guardBroken() {
    for (const status of this.statuses) if (status.guardBroken) return true;
    return false;
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

  // How much more damage this ball takes from weapon hits because of its
  // statuses (Vulnerable, Netted...): 0.25 is 25% more, 0 is none. The
  // Renderer greys the ball by it.
  get vulnerability() {
    return Math.max(0, this.statusMultiplier('damageTakenMultiplier') - 1);
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

  // Damage actually taken from a weapon hit of `damage`, after modifiers (Armor is one).
  reduceDamage(damage) {
    const scaled = damage * this.weapon.damageTakenMultiplier * this.statusMultiplier('damageTakenMultiplier');
    return this.weapon.reduceIncoming(scaled);
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

// Ball.update's hit cooldowns tick: called as a Map's forEach with `this` as
// dt, which deletes or updates each entry in place as a for...of would.
function countDown(time, weapon, cooldowns) {
  if (time - this <= 0) cooldowns.delete(weapon);
  else cooldowns.set(weapon, time - this);
}
