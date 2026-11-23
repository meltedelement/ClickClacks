import { Upgrade } from './Upgrade.js';
import { Status } from '../sim/Status.js';
import { TAU } from '../sim/math.js';
import { formatNumber, percent } from '../utils/format.js';

// Small upgrades any weapon can take. Stat boosts stack linearly from the
// starting value. Each number lives in one constant, which both the upgrade
// and its describe(n) read, so the text can't drift from what it does.

const SHARPENED = 0.2; // more damage, per copy

export class Sharpened extends Upgrade {
  static id = 'damage';
  static displayName = 'Sharpened';
  static describe(n) {
    return `Deal ${percent(SHARPENED * n)} more damage.`;
  }

  get damageMultiplier() {
    return 1 + SHARPENED * this.stacks;
  }
}

const QUICK_SPIN = 0.2; // more spin speed, per copy

export class QuickSpin extends Upgrade {
  static id = 'spin-speed';
  static displayName = 'Quick Spin';
  static describe(n) {
    return `Your weapon spins ${percent(QUICK_SPIN * n)} faster. On the Wand, its orbs circle faster too.`;
  }
  // On the Drone spin speed is every drone's flight speed: far more than a spin.
  // The Tome has nothing that spins.
  static notWeapons = ['drone', 'tome'];

  apply() {
    const { weapon } = this;
    this.base ??= weapon.spinSpeed;
    weapon.spinSpeed += this.base * QUICK_SPIN;
    if (weapon.orbitSpeed) {
      this.orbitBase ??= weapon.orbitSpeed;
      weapon.orbitSpeed += this.orbitBase * QUICK_SPIN;
    }
  }
}

const LONG_BLADE = 0.2; // more length, per copy

export class LongBlade extends Upgrade {
  static id = 'length';
  static displayName = 'Long Blade';
  static describe(n) {
    return `Your weapon is ${percent(LONG_BLADE * n)} longer. On the Wand, its orbs are ${percent(LONG_BLADE * n)} bigger too.`;
  }
  // The Gun's barrel and bullets, or the Drone's drones: next to nothing changes. The Tome has no blade.
  static notWeapons = ['drone', 'gun', 'tome'];

  apply() {
    const { weapon } = this;
    this.base ??= weapon.length;
    weapon.length += this.base * LONG_BLADE;
    if (weapon.orbRadius) {
      this.orbBase ??= weapon.orbRadius;
      weapon.orbRadius += this.orbBase * LONG_BLADE;
    }
  }
}

const HEAVY_BLADE = 0.5; // more thickness, per copy

export class HeavyBlade extends Upgrade {
  static id = 'thickness';
  static displayName = 'Heavy Blade';
  static describe(n) {
    return `Your weapon is ${percent(HEAVY_BLADE * n)} thicker.`;
  }
  // The Gun's barrel and bullets, or the Drone's drones: next to nothing changes. The Tome has no blade.
  static notWeapons = ['drone', 'gun', 'tome'];

  apply() {
    this.base ??= this.weapon.thickness;
    this.weapon.thickness += this.base * HEAVY_BLADE;
    this.weapon.widthScale += HEAVY_BLADE;
  }
}

const COMPACT = 0.12; // smaller radius, per copy

export class Compact extends Upgrade {
  static id = 'small-ball';
  static displayName = 'Compact';
  static maxStacks = 4; // at 9 the ball would have no radius left
  static describe(n) {
    return `Your ball is ${percent(COMPACT * n)} smaller.`;
  }

  apply() {
    this.base ??= this.owner.radius;
    this.owner.radius -= this.base * COMPACT;
  }
}

const VITALITY = 20; // max HP, per copy

export class Vitality extends Upgrade {
  static id = 'health';
  static displayName = 'Vitality';
  static describe(n) {
    return `+${VITALITY * n} max HP.`;
  }

  apply() {
    this.owner.maxHp += VITALITY;
  }
}

// Each copy multiplies, so they compound: two make the cooldown 0.75² as long.
const FOCUS_COOLDOWN = 0.75; // the ability's cooldown is multiplied by this, per copy
const FOCUS_RELOAD = 0.85; // and the Gun's reload by this
const FOCUS_ORBS = 0.85; // and the time the Wand takes to conjure an orb by this

export class Focus extends Upgrade {
  static id = 'cooldown';
  static displayName = 'Focus';
  // The Tome has no ability and nothing to wait on.
  static notWeapons = ['tome'];
  static describe(n) {
    return `Your ability cooldown is ${percent(1 - FOCUS_COOLDOWN ** n)} shorter. On the Gun, reloading is ${percent(1 - FOCUS_RELOAD ** n)} shorter instead, and on the Wand, a new orb takes ${percent(1 - FOCUS_ORBS ** n)} less time to appear.`;
  }

  apply() {
    const { ability, weapon } = this;
    // The Gun's reload is most of its firing cycle, so it gets a smaller cut.
    if (weapon.reloadTime) weapon.reloadTime *= FOCUS_RELOAD;
    // The Wand has no ability: its orbs are what it waits on.
    if (weapon.orbInterval) {
      weapon.orbInterval *= FOCUS_ORBS;
      weapon.orbTimer *= FOCUS_ORBS;
    }
    if (!ability) return;
    ability.cooldown *= FOCUS_COOLDOWN;
    ability.cooldownLeft *= FOCUS_COOLDOWN;
  }
}

const ARMOR = 0.12; // less damage taken, per copy

export class Armor extends Upgrade {
  static id = 'armor';
  static displayName = 'Armor';
  static maxStacks = 5; // at 9 hits would do nothing
  static describe(n) {
    return `Take ${percent(ARMOR * n)} less damage from hits.`;
  }

  get damageTakenMultiplier() {
    return 1 - ARMOR * this.stacks;
  }

  // A steel rim around the ball.
  drawUnder(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.strokeStyle = '#8d949c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 1.5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

const THORN_COLOR = '#4f8a3c';
const THORNS = 12; // spikes drawn
const THORNS_REFLECT = 0.3; // of the damage taken that one copy sends back

export class Thorns extends Upgrade {
  static id = 'thorns';
  static displayName = 'Thorns';
  static description = "When you're hit, the attacker takes 30% of the damage back.";
  // Diminishing returns: each copy reflects its share of what the others let
  // through, so n copies reflect 1 - 0.7^n (30%, 51%, 66%, 76%...), never all of it.
  static reflected(n) {
    return 1 - Math.pow(1 - THORNS_REFLECT, n);
  }

  static describe(n) {
    return `When you're hit, the attacker takes ${percent(Thorns.reflected(n))} of the damage back.`;
  }

  constructor(weapon) {
    super(weapon);
    this.reflectFraction = 0; // of the damage taken, for all the copies together
  }

  apply() {
    this.reflectFraction = Thorns.reflected(this.stacks);
  }

  onOwnerHit(attackerWeapon, sim, damage) {
    const reflected = damage * this.reflectFraction;
    sim.dealDamage(this.owner, attackerWeapon.owner, reflected, { reason: 'thorns', color: THORN_COLOR });
  }

  // Small spikes all around the edge of the ball.
  drawUnder(ctx) {
    const { owner } = this;
    const r = owner.radius;
    ctx.save();
    ctx.fillStyle = THORN_COLOR;
    for (let i = 0; i < THORNS; i++) {
      const a = (i / THORNS) * TAU;
      const side = 0.12;
      ctx.beginPath();
      ctx.moveTo(owner.pos.x + Math.cos(a - side) * r, owner.pos.y + Math.sin(a - side) * r);
      ctx.lineTo(owner.pos.x + Math.cos(a) * (r + 7), owner.pos.y + Math.sin(a) * (r + 7));
      ctx.lineTo(owner.pos.x + Math.cos(a + side) * r, owner.pos.y + Math.sin(a + side) * r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

const HEAL_GLOW_TIME = 0.35; // s the heal ring stays visible
const HEAL_COLOR = '#6be38a';
const LIFESTEAL = 0.2; // of the damage dealt, per copy

export class Lifesteal extends Upgrade {
  static id = 'lifesteal';
  static displayName = 'Lifesteal';
  static describe(n) {
    return `Heal for ${percent(LIFESTEAL * n)} of the damage your hits deal.`;
  }

  constructor(weapon) {
    super(weapon);
    this.glow = 0; // seconds left of the heal ring
  }

  onHit(target, sim, damage) {
    const healed = this.owner.heal(damage * LIFESTEAL * this.stacks);
    if (healed <= 0) return;
    this.glow = HEAL_GLOW_TIME;
    this.emit(sim, 'heal', { text: `+${formatNumber(healed)}`, color: HEAL_COLOR, burst: { color: HEAL_COLOR, count: 6, speed: 120, life: 0.4 } });
  }

  onUpdate(dt) {
    if (this.glow > 0) this.glow -= dt;
  }

  // A thin red line down each blade marks the upgrade.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.strokeStyle = '#d43a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start + this.weapon.length * 0.25, 0);
    ctx.lineTo(start + this.weapon.length * 0.85, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawOver(ctx) {
    if (this.glow <= 0) return;
    const { owner } = this;
    ctx.save();
    ctx.strokeStyle = HEAL_COLOR;
    ctx.globalAlpha = this.glow / HEAL_GLOW_TIME;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 3, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// Crits are rolled by the Simulation on every hit (see Weapon.critChance).
// Crits do double damage to start with (the Daggers' triple), so the first
// copy turns 10% of hits into 2.5x ones, the second 20% into 3x ones...
const CRIT_CHANCE = 0.1; // per copy
const CRIT_DAMAGE = 0.5; // added to the crit multiplier, per copy

export class Critical extends Upgrade {
  static id = 'crit';
  static displayName = 'Critical Hits';
  static describe(n) {
    return `+${percent(CRIT_CHANCE * n)} crit chance, and crits deal ${percent(CRIT_DAMAGE * n)} more damage.`;
  }

  apply() {
    this.weapon.critChance += CRIT_CHANCE;
    this.weapon.critMultiplier += CRIT_DAMAGE;
  }
}

// ---- Sabotage ---------------------------------------------------------------------

const SABOTAGE_STEP = 0.01; // more damage taken per point of damage a hit deals, per copy
const SABOTAGE_CAP = 0.2; // most it builds up to, per copy
const SABOTAGE_TIME = 4; // s it lasts after the last hit

// Every hit leaves the enemy Vulnerable, more the harder it was, so a swarm
// of light pokes builds it no faster than a few heavy blows.
export class Sabotage extends Upgrade {
  static id = 'sabotage';
  static displayName = 'Sabotage';
  static describe(n) {
    return `Your hits make the enemy take more damage: +${percent(SABOTAGE_STEP * n)} per damage dealt, up to +${percent(SABOTAGE_CAP * n)}. Wears off ${SABOTAGE_TIME}s after your last hit.`;
  }

  onHit(target, sim, damage, point, hit = {}) {
    if (!target.alive || sim.over) return;
    const stacks = hit.upgradeScale === undefined || hit.upgradeScale === 1 ? this.stacks : this.stacks * hit.upgradeScale;
    Vulnerable.add(target, { source: this.owner, step: SABOTAGE_STEP * damage * stacks, cap: SABOTAGE_CAP * stacks, duration: SABOTAGE_TIME }, sim);
  }
}

// Takes `amount` more damage from weapon hits (0.2 = 20% more). Each new
// application adds its step, up to the highest cap any of them had, and
// refreshes the time; it all wears off together. The Renderer greys the ball
// by how vulnerable it is (see Ball.vulnerability), as it does for any other
// status that raises damage taken.
export class Vulnerable extends Status {
  constructor({ source, duration, cap }) {
    super({ source, duration });
    this.cap = cap;
    this.amount = 0;
  }

  // Adds `step` to `ball`'s vulnerability, putting the status on it if it hasn't got it.
  static add(ball, { source, step, cap, duration }, sim) {
    let status = ball.statuses.find((s) => s instanceof Vulnerable);
    if (!status) {
      status = new Vulnerable({ source, duration, cap });
      ball.addStatus(status, sim);
    }
    status.source = source;
    status.cap = Math.max(status.cap, cap);
    status.timeLeft = Math.max(status.timeLeft, duration);
    status.amount = Math.min(status.cap, status.amount + step);
    return status;
  }

  get damageTakenMultiplier() {
    return 1 + this.amount;
  }
}
