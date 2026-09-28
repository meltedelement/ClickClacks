import { Upgrade } from './Upgrade.js';
import { TAU } from '../sim/math.js';
import { formatNumber } from '../utils/format.js';

// Small upgrades any weapon can take. Descriptions are per copy; stat
// boosts stack linearly from the starting value.

export class Sharpened extends Upgrade {
  static id = 'damage';
  static displayName = 'Sharpened';
  static description = 'Deal 20% more damage.';

  get damageMultiplier() {
    return 1 + 0.2 * this.stacks;
  }
}

export class QuickSpin extends Upgrade {
  static id = 'spin-speed';
  static displayName = 'Quick Spin';
  static description = 'Your weapon spins 20% faster.';

  apply() {
    this.base ??= this.weapon.spinSpeed;
    this.weapon.spinSpeed += this.base * 0.2;
  }
}

export class LongBlade extends Upgrade {
  static id = 'length';
  static displayName = 'Long Blade';
  static description = 'Your weapon is 20% longer.';

  apply() {
    this.base ??= this.weapon.length;
    this.weapon.length += this.base * 0.2;
  }
}

export class HeavyBlade extends Upgrade {
  static id = 'thickness';
  static displayName = 'Heavy Blade';
  static description = 'Your weapon is 50% thicker, so it hits and blocks more.';

  apply() {
    this.base ??= this.weapon.thickness;
    this.weapon.thickness += this.base * 0.5;
    this.weapon.widthScale += 0.5;
  }
}

export class Compact extends Upgrade {
  static id = 'small-ball';
  static displayName = 'Compact';
  static description = 'Your ball is 12% smaller: a harder target.';
  static maxStacks = 3;

  apply() {
    this.base ??= this.owner.radius;
    this.owner.radius -= this.base * 0.12;
  }
}

export class Vitality extends Upgrade {
  static id = 'health';
  static displayName = 'Vitality';
  static description = '+25 max HP.';

  apply() {
    this.owner.maxHp += 25;
  }
}

export class Swift extends Upgrade {
  static id = 'move-speed';
  static displayName = 'Swift';
  static description = 'Your ball moves 15% faster.';

  apply() {
    this.base ??= this.owner.speed;
    this.owner.speed += this.base * 0.15;
  }
}

export class Focus extends Upgrade {
  static id = 'cooldown';
  static displayName = 'Focus';
  static description = 'Your ability cooldown is 25% shorter (each copy shortens what is left).';

  apply() {
    const { ability } = this;
    if (!ability) return;
    ability.cooldown *= 0.75;
    ability.cooldownLeft *= 0.75;
  }
}

export class Armor extends Upgrade {
  static id = 'armor';
  static displayName = 'Armor';
  static description = 'Take 1 less damage from every hit (but never less than half).';

  apply() {
    this.owner.armor += 1;
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
const THORNS = 12;

export class Thorns extends Upgrade {
  static id = 'thorns';
  static displayName = 'Thorns';
  static description = 'Whoever hits you takes 30% of the damage back.';

  constructor(weapon) {
    super(weapon);
    this.reflectFraction = 0.3;
  }

  onOwnerHit(attackerWeapon, sim, damage) {
    const reflected = damage * this.reflectFraction * this.stacks;
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

export class Lifesteal extends Upgrade {
  static id = 'lifesteal';
  static displayName = 'Lifesteal';
  static description = 'Hits heal you for 25% of the damage dealt.';

  constructor(weapon) {
    super(weapon);
    this.healFraction = 0.25;
    this.glow = 0; // seconds left of the heal ring
  }

  onHit(target, sim, damage) {
    const healed = this.owner.heal(damage * this.healFraction * this.stacks);
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
export class Critical extends Upgrade {
  static id = 'crit';
  static displayName = 'Critical Hits';
  static description = '15% chance for a hit to deal double damage.';

  apply() {
    this.weapon.critChance += 0.15;
  }
}

// Much bigger than the other small upgrades; closer to a transformation.
export class ExtraBlade extends Upgrade {
  static id = 'extra-blade';
  static displayName = 'Extra Blade';
  static description = 'Adds another copy of your weapon.';

  // The extra blade is drawn and collides like the rest, so it needs no visuals of its own.
  apply() {
    this.weapon.blades += 1;
  }
}
