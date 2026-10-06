import { Upgrade } from './Upgrade.js';
import { Burning } from './sword-transformations.js';
import { FireTrail } from './spear-transformations.js';
import { TAU, add, distance, dot, fromAngle, normalize, scale, sub } from '../sim/math.js';

// Transformations for the Gun: big upgrades that change how it shoots. Like
// the other weapons', they combine with each other and with the small
// upgrades, and are applied before the small ones. They work through the
// Gun's stats (`volley`, `ricochets`, `bankShots`, `bayonet`, `nearMiss`,
// `model`...) and its bullet hooks (see Gun.js).

class GunTransformation extends Upgrade {
  static weapons = ['gun'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Six-Shooter ----------------------------------------------------------------

const SPARK = '#fff3b0';

export class SixShooter extends GunTransformation {
  static id = 'six-shooter';
  static displayName = 'Six-Shooter';
  static description =
    'Trick shots: your bullets ricochet off walls up to twice, but only hurt anyone once they have bounced. You aim off the walls, and every bullet that hits is a critical hit.';

  apply() {
    this.weapon.ricochets = 2;
    this.weapon.bankShots = true;
  }

  // Every bullet that can hit has come off a wall. The bayonet doesn't crit.
  critsAt() {
    return this.weapon.striking !== null;
  }

  onBulletBounce(bullet, sim) {
    this.emit(sim, 'ricochet', { pos: bullet.pos, burst: { color: SPARK, count: 4, speed: 140, life: 0.2, size: 1.5 } });
  }

  // A cowboy hat.
  drawOver(ctx) {
    const { pos, radius } = this.owner;
    const { x } = pos;
    const brim = pos.y - radius * 0.62;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;

    // Crown, pinched in at the top
    ctx.fillStyle = '#9a6a3a';
    ctx.beginPath();
    ctx.moveTo(x - 17, brim);
    ctx.lineTo(x - 15, brim - 20);
    ctx.quadraticCurveTo(x - 8, brim - 26, x, brim - 21);
    ctx.quadraticCurveTo(x + 8, brim - 26, x + 15, brim - 20);
    ctx.lineTo(x + 17, brim);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Band
    ctx.fillStyle = '#3b2414';
    ctx.fillRect(x - 16.5, brim - 7, 33, 4);

    // Brim, curled up at both sides
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.moveTo(x - radius - 6, brim - 9);
    ctx.quadraticCurveTo(x - radius + 2, brim + 1, x, brim + 2);
    ctx.quadraticCurveTo(x + radius - 2, brim + 1, x + radius + 6, brim - 9);
    ctx.quadraticCurveTo(x + radius - 6, brim - 1, x, brim - 3);
    ctx.quadraticCurveTo(x - radius + 6, brim - 1, x - radius - 6, brim - 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Shotgun --------------------------------------------------------------------

export class Shotgun extends GunTransformation {
  static id = 'shotgun';
  static displayName = 'Shotgun';
  static description = 'Fire your whole magazine at once, as a very wide spray of pellets, then reload, a third faster than before.';

  apply() {
    const { weapon } = this;
    weapon.volley = true;
    weapon.inaccuracy *= 2.5;
    weapon.reloadTime *= 0.64;
    weapon.length += 8;
    weapon.model = 'shotgun';
  }
}

// ---- SMG ------------------------------------------------------------------------

export class Smg extends GunTransformation {
  static id = 'smg';
  static displayName = 'SMG';
  static description = 'A submachine gun: five times the magazine, fired 3.5 times as fast, but each bullet deals a quarter of the damage and barely pushes.';

  apply() {
    const { weapon } = this;
    weapon.magazine *= 5;
    weapon.ammo = weapon.magazine;
    weapon.fireInterval /= 3.5;
    weapon.damage *= 0.25;
    weapon.damagePerHit /= 20; // a quarter of the damage, over five times the hits
    weapon.bulletKnockback *= 0.35;
    weapon.model = 'smg';
  }
}

// ---- High-Ex --------------------------------------------------------------------

const BLAST = '#ff8a3d';
const BLAST_CORE = '#ffd23f';
const BLAST_TIME = 0.25; // s a blast ring takes to spread

export class HighEx extends GunTransformation {
  static id = 'high-ex';
  static displayName = 'High-Ex';
  static description =
    "Explosive rounds: a bullet that passes within 30 px of an enemy, or hits its weapon or shield, explodes, dealing half the bullet's damage to every enemy within 40 px.";

  constructor(weapon) {
    super(weapon);
    this.nearMiss = 30; // px past an enemy's edge
    this.blastRadius = 40; // px from the blast to an enemy's edge
    this.damageShare = 0.5; // of the bullet's damage
    this.blasts = []; // { pos, timeLeft } for drawing
  }

  apply() {
    this.weapon.nearMiss = this.nearMiss;
    this.weapon.tracer = BLAST;
  }

  onBulletNearMiss(bullet, enemy, point, sim) {
    this.explode(point, sim);
  }

  onBulletBlocked(bullet, enemy, point, sim) {
    this.explode(point, sim);
  }

  explode(pos, sim) {
    const { owner } = this;
    if (!sim.over) {
      const damage = this.weapon.getDamage() * this.damageShare;
      const reach = this.blastRadius * owner.size;
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner || distance(enemy.pos, pos) - enemy.radius > reach) continue;
        sim.dealDamage(owner, enemy, damage, { reason: 'explosion', color: BLAST });
      }
    }
    this.blasts.push({ pos: { ...pos }, timeLeft: BLAST_TIME });
    this.emit(sim, 'blast', { pos, shake: 1.5, burst: { color: BLAST, count: 10, speed: 220, life: 0.3, size: 2.5 } });
  }

  onUpdate(dt) {
    if (this.blasts.length === 0) return;
    for (const blast of this.blasts) blast.timeLeft -= dt;
    this.blasts = this.blasts.filter((blast) => blast.timeLeft > 0);
  }

  // A red band round the barrel near the muzzle.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = '#d62b2b';
    ctx.fillRect(start + this.weapon.length - 9, -3, 3, 6);
    ctx.restore();
  }

  drawOver(ctx) {
    if (this.blasts.length === 0) return;
    const reach = this.blastRadius * this.owner.size;
    ctx.save();
    for (const { pos, timeLeft } of this.blasts) {
      const t = 1 - timeLeft / BLAST_TIME;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, reach * Math.sqrt(t), 0, TAU);
      ctx.fillStyle = BLAST_CORE;
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.fill();
      ctx.strokeStyle = BLAST;
      ctx.globalAlpha = 0.9 * (1 - t);
      ctx.lineWidth = 5 * (1 - t) + 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Grenadier ------------------------------------------------------------------

const GRENADE = '#55652e';
const GRENADE_DARK = '#33401b';
const GRENADE_RADIUS = 6; // px

export class Grenadier extends GunTransformation {
  static id = 'grenadier';
  static displayName = 'Grenadier';
  static description =
    'Carry 3 grenades, lobbed at enemies within 300 px. Each one blows up 1 s after it is thrown, dealing 6 damage to enemies within 60 px and blowing them back. Once all 3 are gone, restocking takes 9 s.';

  constructor(weapon) {
    super(weapon);
    this.capacity = 3;
    this.throwInterval = 0.6; // s between two throws
    this.throwRange = 300; // px, centre to centre
    this.restockTime = 9; // s
    this.fuse = 1; // s from throw to blast
    this.drag = 900; // px/s² a grenade slows by as it skids along the floor
    this.maxThrowSpeed = 800; // px/s
    this.blastRadius = 60; // px from the blast to an enemy's edge
    this.damage = 6;
    this.blastKnockback = 1.2; // enemies fly off at their speed x this

    this.grenades = this.capacity;
    this.throwTimer = 0;
    this.restockLeft = 0; // s of restocking left; above 0 while restocking
    this.live = []; // { pos, vel, fuseLeft }
    this.blasts = []; // { pos, timeLeft } for drawing
    this.time = 0; // for the fuse blink
  }

  onUpdate(dt, sim) {
    this.time += dt;
    this.throwTimer = Math.max(0, this.throwTimer - dt);
    if (this.restockLeft > 0) {
      this.restockLeft -= dt;
      if (this.restockLeft <= 0) {
        this.grenades = this.capacity;
        this.emit(sim, 'restock');
      }
    }
    if (this.blasts.length > 0) {
      for (const blast of this.blasts) blast.timeLeft -= dt;
      this.blasts = this.blasts.filter((blast) => blast.timeLeft > 0);
    }
    if (this.live.length > 0) this.moveGrenades(dt, sim);
    if (sim.over || this.grenades === 0 || this.throwTimer > 0) return;
    const enemy = this.enemyWithin(sim, this.throwRange);
    if (enemy) this.lob(enemy, sim);
  }

  // Throws a grenade so it skids to a stop where `enemy` will be when it
  // blows (allowing for it bouncing off the walls on the way).
  lob(enemy, sim) {
    const { owner } = this;
    const { width, height } = sim.arena;
    const r = enemy.radius;
    const target = {
      x: fold(enemy.pos.x + enemy.vel.x * this.fuse, r, width - r),
      y: fold(enemy.pos.y + enemy.vel.y * this.fuse, r, height - r),
    };
    const dir = normalize(sub(target, owner.pos));
    const speed = Math.min(this.maxThrowSpeed, Math.sqrt(2 * this.drag * distance(target, owner.pos)));
    this.live.push({ pos: add(owner.pos, scale(dir, owner.radius)), vel: scale(dir, speed), fuseLeft: this.fuse });
    this.grenades -= 1;
    this.throwTimer = this.throwInterval;
    if (this.grenades === 0) this.restockLeft = this.restockTime;
    this.emit(sim, 'throw');
  }

  // Skids every grenade on, slowing, off the walls and off enemies, and blows
  // up the ones whose fuse has run out.
  moveGrenades(dt, sim) {
    const { width, height } = sim.arena;
    const r = GRENADE_RADIUS * this.owner.size;
    let kept = 0;
    for (const grenade of this.live) {
      const { pos, vel } = grenade;
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > 0) {
        const slowed = Math.max(0, speed - this.drag * dt) / speed;
        vel.x *= slowed;
        vel.y *= slowed;
      }
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      if (pos.x < r || pos.x > width - r) {
        pos.x = pos.x < r ? 2 * r - pos.x : 2 * (width - r) - pos.x;
        vel.x = -vel.x;
      }
      if (pos.y < r || pos.y > height - r) {
        pos.y = pos.y < r ? 2 * r - pos.y : 2 * (height - r) - pos.y;
        vel.y = -vel.y;
      }
      for (const enemy of sim.aliveBalls) {
        if (enemy === this.owner || distance(enemy.pos, pos) > enemy.radius + r) continue;
        const n = normalize(sub(pos, enemy.pos));
        const into = dot(vel, n);
        if (into < 0) {
          // Bounces off, losing half its speed.
          vel.x = (vel.x - 2 * into * n.x) * 0.5;
          vel.y = (vel.y - 2 * into * n.y) * 0.5;
        }
      }
      grenade.fuseLeft -= dt;
      if (grenade.fuseLeft <= 0) this.explode(pos, sim);
      else this.live[kept++] = grenade;
    }
    this.live.length = kept;
  }

  explode(pos, sim) {
    const { owner } = this;
    if (!sim.over) {
      const damage = this.damage * this.weapon.multiplier('damageMultiplier');
      const reach = this.blastRadius * owner.size;
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner || distance(enemy.pos, pos) - enemy.radius > reach) continue;
        enemy.vel = scale(normalize(sub(enemy.pos, pos)), enemy.speed * this.blastKnockback);
        sim.dealDamage(owner, enemy, damage, { reason: 'explosion', color: BLAST });
      }
    }
    this.blasts.push({ pos: { ...pos }, timeLeft: BLAST_TIME * 1.6 });
    this.emit(sim, 'explode', { pos, shake: 5, burst: { color: BLAST, count: 24, speed: 300, life: 0.45, size: 3 } });
  }

  drawUnder(ctx) {
    const size = this.owner.size;
    for (const { pos, fuseLeft } of this.live) {
      // The fuse light blinks faster as it runs down.
      const lit = Math.sin((this.time * 14) / Math.max(0.15, fuseLeft / this.fuse)) > 0;
      drawGrenade(ctx, pos.x, pos.y, GRENADE_RADIUS * size, lit);
    }
  }

  drawOver(ctx) {
    this.drawBelt(ctx);
    if (this.blasts.length === 0) return;
    const reach = this.blastRadius * this.owner.size;
    ctx.save();
    for (const { pos, timeLeft } of this.blasts) {
      const t = 1 - timeLeft / (BLAST_TIME * 1.6);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, reach * Math.sqrt(t), 0, TAU);
      ctx.fillStyle = BLAST_CORE;
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.fill();
      ctx.strokeStyle = BLAST;
      ctx.globalAlpha = 0.9 * (1 - t);
      ctx.lineWidth = 8 * (1 - t) + 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The grenades still in hand, in a row above the HP; spent ones are hollow.
  drawBelt(ctx) {
    const { pos, radius } = this.owner;
    const size = this.owner.size;
    const r = 4.5 * size;
    const y = pos.y - radius * 0.52;
    ctx.save();
    for (let i = 0; i < this.capacity; i++) {
      const x = pos.x + (i - (this.capacity - 1) / 2) * r * 2.6;
      if (i < this.grenades) {
        drawGrenade(ctx, x, y, r, false);
        continue;
      }
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// A round grenade at (x, y) with its lever on top and the fuse light on or off.
function drawGrenade(ctx, x, y, r, lit) {
  ctx.save();
  ctx.fillStyle = GRENADE;
  ctx.strokeStyle = GRENADE_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.fillStyle = '#8d949c';
  ctx.fillRect(x - r * 0.35, y - r * 1.45, r * 0.7, r * 0.55);
  if (lit) {
    ctx.fillStyle = '#ff3b2f';
    ctx.beginPath();
    ctx.arc(x + r * 0.5, y - r * 1.2, r * 0.35, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// `v` folded back into [lo, hi] as if it had bounced off both ends.
function fold(v, lo, hi) {
  const span = hi - lo;
  if (span <= 0) return (lo + hi) / 2;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t > span ? 2 * span - t : t);
}

// ---- Bayonet --------------------------------------------------------------------

const STEEL = '#d6dbe0';

export class Bayonet extends GunTransformation {
  static id = 'bayonet';
  static displayName = 'Bayonet';
  static description =
    "A bayonet on the end of the barrel: a short blade that stabs an enemy who comes close for half your bullet damage, at most once every 2 s. Stabs go straight through weapons and shields, but the bayonet can't block anything either.";

  constructor(weapon) {
    super(weapon);
    this.reach = 20; // px past the muzzle
    this.stabShare = 0.5; // of a bullet's damage
    this.stabCooldown = 2; // s before the bayonet can stab the same enemy again
  }

  apply() {
    this.weapon.bayonet = this.reach;
  }

  // Stabs only, not shots.
  damageMultiplierAt() {
    return this.weapon.striking ? 1 : this.stabShare;
  }

  // The gun keeps the bayonet pointed at the enemy, so it would stab again
  // the moment the usual hit cooldown ran out: give it a longer one of its
  // own. Bullets don't wait on hit cooldowns.
  onHit(target) {
    if (!this.weapon.striking) target.hitCooldowns.set(this.weapon, this.stabCooldown);
  }

  // The gun always faces its target, so a bayonet that blocked would sit
  // between the two balls as a perfect guard. Bullets keep the usual rules.
  get unblockable() {
    return !this.weapon.striking;
  }

  drawBlade(ctx, start) {
    const { weapon } = this;
    const muzzle = start + weapon.length;
    const tip = muzzle + weapon.bayonet;
    ctx.save();
    // Mounting ring round the barrel
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(muzzle - 7, -3.5, 5, 7);
    // Blade, with a fuller down the middle
    ctx.fillStyle = STEEL;
    ctx.strokeStyle = '#7d848c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(muzzle - 3, -2.5);
    ctx.lineTo(tip - 6, -2.5);
    ctx.lineTo(tip, 0);
    ctx.lineTo(tip - 6, 2.5);
    ctx.lineTo(muzzle - 3, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(muzzle, 0);
    ctx.lineTo(tip - 8, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Hotshot --------------------------------------------------------------------

const FIRE = '#ff8a3d';

export class Hotshot extends GunTransformation {
  static id = 'hotshot';
  static displayName = 'Hotshot';
  static description =
    'Incendiary rounds: your bullets leave a trail of fire for 0.5 s that sets enemies who touch it burning for 0.5 damage every 0.5 s for 1.5 s, and deal 20% more damage to burning enemies.';

  constructor(weapon) {
    super(weapon);
    this.burnDamage = 0.5; // per tick
    this.burnTick = 0.5; // s
    this.burnDuration = 1.5; // s
    this.burningBonus = 0.2; // extra damage share against a burning enemy
    this.trail = new FireTrail();
    this.trail.duration = 0.5;
    this.trail.width = 10;
    this.time = 0; // for the flicker
  }

  apply() {
    this.weapon.tracer = FIRE;
  }

  // Each bullet extends its own piece of the trail.
  onBulletMove(bullet, from) {
    bullet.trail = this.trail.lay(from, bullet.pos, bullet.trail ?? null);
  }

  damageMultiplierAt() {
    return this.weapon.strikeTarget?.hasStatus(Burning) ? 1 + this.burningBonus : 1;
  }

  // Burns out old trail, and sets enemies standing in it burning.
  onUpdate(dt, sim) {
    this.time += dt;
    this.trail.update(dt);
    if (sim.over || this.trail.pieces.length === 0) return;
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner || enemy.hasStatus(Burning) || !this.trail.touches(enemy)) continue;
      const { burnDamage: damage, burnTick: tick, burnDuration: duration } = this;
      enemy.addStatus(new Burning({ source: this.owner, duration, damage, tick }), sim);
      this.emit(sim, 'ignite', { pos: enemy.pos, burst: { color: FIRE, count: 8, speed: 120, life: 0.35 } });
    }
  }

  drawUnder(ctx) {
    this.trail.draw(ctx);
  }

  // The end of the barrel glowing red hot.
  drawBlade(ctx, start) {
    const end = start + this.weapon.length;
    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.time * 25);
    ctx.fillStyle = FIRE;
    ctx.fillRect(end - 8, -3, 8, 6);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(end - 3, -2, 3, 4);
    ctx.restore();
  }
}
