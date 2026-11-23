import { Upgrade } from './Upgrade.js';
import { Burning } from './sword-transformations.js';
import { reflectDamage, reflectedBy } from '../sim/reflect.js';
import { FireTrail } from './spear-transformations.js';
import { TAU, add, distance, dot, fromAngle, hypot, normalize, scale, sub } from '../sim/math.js';
import * as looks from './gun-looks.js';

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
  static description = 'Every shot is banked off a wall at the nearest enemy. Bullets only hurt after they bounce, but always crit.';

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
  static description = 'Fire your whole magazine at once in a spread, and reload faster.';

  apply() {
    const { weapon } = this;
    weapon.volley = true;
    weapon.inaccuracy *= 2.5;
    weapon.reloadTime *= 0.64;
    weapon.length += 8;
    weapon.model = 'shotgun';
  }

  // A bandolier of shells.
  drawOver(ctx) {
    looks.drawShellBandolier(ctx, this.owner);
  }
}

// ---- SMG ------------------------------------------------------------------------

export class Smg extends GunTransformation {
  static id = 'smg';
  static displayName = 'SMG';
  static description = 'Swap your gun for an SMG: a 30-round magazine fired 3.5 times as fast, for a quarter of the damage per bullet.';

  apply() {
    const { weapon } = this;
    weapon.magazine *= 5;
    weapon.fireInterval /= 3.5;
    weapon.damage *= 0.25;
    weapon.damagePerHit /= 20; // a quarter of the damage, over five times the hits
    weapon.bulletKnockback *= 0.35;
    weapon.model = 'smg';
  }

  // Only for drawing: spent casings flicked out of the gun, one per round fired.
  onUpdate(dt) {
    const { weapon, owner } = this;
    this.casings ??= [];
    this.ejected ??= 0;
    this.lastAmmo ??= weapon.ammo;
    for (let fired = this.lastAmmo - weapon.ammo; fired > 0; fired--) {
      // Out of the right-hand side, a little backwards, spread by a golden-ratio step
      const spread = ((this.ejected++ * 0.618) % 1) - 0.5;
      const port = add(owner.pos, fromAngle(weapon.angle, owner.radius + weapon.gap + 10 * owner.size));
      const out = fromAngle(weapon.angle + Math.PI * 0.6 + spread * 0.7, 170 + 60 * spread);
      this.casings.push({ pos: port, vel: add(out, scale(owner.vel, 0.6)), angle: weapon.angle, spin: 25 + 20 * spread, life: 0.55, maxLife: 0.55 });
    }
    this.lastAmmo = weapon.ammo;
    for (const casing of this.casings) {
      casing.pos = add(casing.pos, scale(casing.vel, dt));
      casing.vel = scale(casing.vel, Math.max(0, 1 - 4 * dt));
      casing.angle += casing.spin * dt;
      casing.life -= dt;
    }
    if (this.casings.length > 0 && this.casings[0].life <= 0) this.casings = this.casings.filter((casing) => casing.life > 0);
  }

  // Casings on the floor, under the balls.
  drawUnder(ctx) {
    if (this.casings?.length) looks.drawCasings(ctx, this.casings, this.owner.size);
  }

  // A tactical headset.
  drawOver(ctx) {
    looks.drawHeadset(ctx, this.owner);
  }
}

// ---- High-Ex --------------------------------------------------------------------

const BLAST = '#ff8a3d';
const BLAST_CORE = '#ffd23f';
const BLAST_TIME = 0.25; // s a blast ring takes to spread

// High-Ex and Hotshot: special rounds for a future cop's sidearm. Either swaps
// the revolver for the blaster (a Shotgun or SMG keeps its own gun) and adds
// its colour to the blaster's ammo lights, and the first of them on the ball
// draws the riot helmet.
function loadSpecialRound(upgrade, color) {
  const { weapon } = upgrade;
  if (weapon.model === 'revolver') weapon.model = 'blaster';
  if (!weapon.ammoLights.includes(color)) weapon.ammoLights.push(color);
}

function drawRiotHelmetOnce(ctx, upgrade) {
  const first = upgrade.weapon.upgrades.find((u) => u instanceof HighEx || u instanceof Hotshot);
  if (first === upgrade) looks.drawRiotHelmet(ctx, upgrade.owner, upgrade.time);
}

export class HighEx extends GunTransformation {
  static id = 'high-ex';
  static displayName = 'High-Ex';
  static description = 'Bullets explode when they pass close to an enemy or get blocked, hitting everyone nearby for half damage.';

  constructor(weapon) {
    super(weapon);
    this.nearMiss = 30; // px past an enemy's edge
    this.blastRadius = 40; // px from the blast to an enemy's edge
    this.damageShare = 0.5; // of the bullet's damage
    this.blasts = []; // { pos, timeLeft } for drawing
    this.time = 0; // for the helmet's visor glint
  }

  apply() {
    loadSpecialRound(this, '#ff3b2f');
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
      // Half a bullet as a secondary weapon hit (see Simulation.applySecondaryHit):
      // crits, Sharpened, Armor, Lifesteal... apply; it doesn't grow the gun.
      const { weapon } = this;
      const damage = (weapon.baseDamage + weapon.sum('bonusDamage')) * this.damageShare;
      const reach = this.blastRadius * owner.size;
      for (const enemy of [...sim.aliveBalls]) {
        if (enemy === owner || distance(enemy.pos, pos) - enemy.radius > reach) continue;
        sim.applySecondaryHit(owner, enemy, damage, { reason: 'explosion', color: BLAST, point: pos });
      }
    }
    this.blasts.push({ pos: { ...pos }, timeLeft: BLAST_TIME });
    this.emit(sim, 'blast', { pos, shake: 1.5, burst: { color: BLAST, count: 10, speed: 220, life: 0.3, size: 2.5 } });
  }

  onUpdate(dt) {
    this.time += dt;
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

  // The riot helmet, and the blasts.
  drawOver(ctx) {
    drawRiotHelmetOnce(ctx, this);
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
  static description = 'Throw grenades at nearby enemies. You carry 3, and get them back 9s after throwing the last.';

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
      const speed = hypot(vel.x, vel.y);
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
      // A parrying ball sends it back at the thrower, to blow up there.
      if (!grenade.reflector && !sim.over) {
        const reflector = reflectedBy(sim, this.owner, pos);
        if (reflector) {
          grenade.reflector = reflector;
          const back = sub(this.owner.pos, pos);
          const dir = normalize(back);
          const speed = Math.min(this.maxThrowSpeed, Math.sqrt(2 * this.drag * hypot(back.x, back.y)));
          vel.x = dir.x * speed;
          vel.y = dir.y * speed;
        }
      }
      for (const enemy of sim.aliveBalls) {
        if (enemy === this.owner || enemy === grenade.reflector || distance(enemy.pos, pos) > enemy.radius + r) continue;
        const n = normalize(sub(pos, enemy.pos));
        const into = dot(vel, n);
        if (into < 0) {
          // Bounces off, losing half its speed.
          vel.x = (vel.x - 2 * into * n.x) * 0.5;
          vel.y = (vel.y - 2 * into * n.y) * 0.5;
        }
      }
      grenade.fuseLeft -= dt;
      if (grenade.fuseLeft <= 0) this.explode(pos, sim, grenade.reflector);
      else this.live[kept++] = grenade;
    }
    this.live.length = kept;
  }

  // A grenade a parrying `reflector` sent back hurts everyone but the reflector, as the reflector.
  explode(pos, sim, reflector = null) {
    const { owner } = this;
    const thrower = reflector ?? owner;
    if (!sim.over) {
      const base = this.damage * this.weapon.multiplier('damageMultiplier');
      const damage = reflector ? reflectDamage(reflector, base) : base;
      const reach = this.blastRadius * owner.size;
      for (const enemy of sim.aliveBalls) {
        if (enemy === thrower || distance(enemy.pos, pos) - enemy.radius > reach) continue;
        enemy.vel = scale(normalize(sub(enemy.pos, pos)), enemy.speed * this.blastKnockback);
        sim.dealDamage(thrower, enemy, damage, { reason: 'explosion', color: BLAST });
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

  // The grenades still in hand, hanging from hooks on a belt; spent ones leave a hook empty.
  drawBelt(ctx) {
    looks.drawGrenadeBelt(ctx, this.owner, this.capacity, this.grenades, (x, y, r) => drawGrenade(ctx, x, y, r, false));
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
  static description = 'A blade on the end of your gun stabs enemies up close for half damage.';

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
  onHit(target, sim, damage, point, hit = {}) {
    if (!this.weapon.striking && !hit.secondary) target.hitCooldowns.set(this.weapon, this.stabCooldown);
  }

  // The gun always faces its target, so a bayonet that blocked would sit
  // between the two balls as a perfect guard. Bullets keep the usual rules.
  get unblockable() {
    return !this.weapon.striking;
  }

  // A steel infantry helmet.
  drawOver(ctx) {
    looks.drawInfantryHelmet(ctx, this.owner);
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
  static description = 'Bullets leave a trail of fire, and deal 20% more damage to burning enemies.';

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
    loadSpecialRound(this, FIRE);
    this.weapon.tracer = FIRE;
  }

  // The riot helmet (once, with High-Ex too).
  drawOver(ctx) {
    drawRiotHelmetOnce(ctx, this);
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
