import { Upgrade } from './Upgrade.js';
import { Status } from '../sim/Status.js';
import { TAU, distance, hypot } from '../sim/math.js';
import { CONFIG } from '../config.js';
import { projectileBlockedBy } from '../weapons/projectile.js';
import { WILD_COLORS } from '../weapons/Wand.js';
import * as looks from './wand-looks.js';
import { Burning } from './sword-transformations.js';
import { GuardBroken } from './spear-transformations.js';

// Transformations for the Wand: big upgrades that change its orbs. Like the
// other weapons', they combine with each other and with the small upgrades,
// and are applied before the small ones. They work through the Wand's orb
// fields (`elements`, `orbsTouch`, `spikeLength`, `wander`, `popKnockback`...),
// its `onOrbPop` hook and `blast` (see Wand.js). A pop's hits are weapon hits
// made while `weapon.popping` is true, so `onHit` can tell them from the stick's.
//
// The elements (Pyromancer's fire, Aeromancer's air, Hydromancer's water,
// Geomancer's earth, Wild Magic) all mix: each sets its flag in
// `weapon.elements` and the Wand draws the blend. With Pyromancer the orbs
// become a ring of fire that never pops, so the others change the ring
// instead: Geomancer gives it stone spikes that reach further, and the rest
// hear about every burn that lands through `onRingBurn(enemy, sim)` (a gust,
// a scald, a random hex). Evoker splits popping orbs, so it isn't offered
// with Pyromancer.

class WandTransformation extends Upgrade {
  static weapons = ['wand'];
  static maxStacks = 1;
  static transformation = true;
}

// True for a weapon hit from one of the Wand's pops (not the stick, not a
// secondary hit).
function fromPop(weapon, hit) {
  return weapon.popping && !hit.secondary;
}

// ---- Merlin ---------------------------------------------------------------------

const EXCALIBUR = '#9fe6ff';
const EXCALIBUR_GLOW = 'rgba(159, 230, 255, 0.35)';

export class Merlin extends WandTransformation {
  static id = 'merlin';
  static displayName = 'Merlin';
  static description = 'Every few seconds, swing a magical Excalibur in a wide, fast sweep. Every hit it lands conjures a new orb.';

  drawOver(ctx) {
    looks.drawWizardHat(ctx, this.owner, this.weapon.time);
  }

  constructor(weapon) {
    super(weapon);
    this.cooldown = 6; // s between swings
    this.cooldownLeft = 2.5;
    this.range = 170; // px, centre to centre: only swing at someone this close
    this.duration = 0.55; // s a swing lasts
    this.extraLength = 55; // px the blade grows by while swinging
    this.spin = 3.5; // spin multiplier while swinging
    this.extraDamage = 4; // added to the stick's damage while swinging
    this.extraOrbs = 2; // a swing's hits can conjure this many orbs past maxOrbs

    this.swingLeft = 0; // s; above 0 while swinging
    this.added = 0; // px of length added right now (grows in a royale)
  }

  apply() {
    this.weapon.model = 'staff';
  }

  get swinging() {
    return this.swingLeft > 0;
  }

  get spinMultiplier() {
    return this.swinging ? this.spin : 1;
  }

  get bonusDamage() {
    return this.swinging && !this.weapon.popping ? this.extraDamage : 0;
  }

  onUpdate(dt, sim) {
    if (this.swinging) {
      this.swingLeft -= dt;
      if (!this.swinging) this.sheathe();
      return;
    }
    this.cooldownLeft -= dt;
    if (this.cooldownLeft > 0 || sim.over || !this.enemyWithin(sim, this.range)) return;
    this.cooldownLeft = this.cooldown;
    this.swingLeft = this.duration;
    this.added = this.extraLength * this.owner.size;
    this.weapon.length += this.added;
    this.emit(sim, 'excalibur', { burst: { color: EXCALIBUR, count: 14, speed: 200, life: 0.35, size: 2 } });
  }

  sheathe() {
    this.weapon.length -= this.added;
    this.added = 0;
  }

  onGrow(factor) {
    this.added *= factor;
  }

  onHit(target, sim, damage, point, hit = {}) {
    const { weapon } = this;
    if (!this.swinging || weapon.popping || hit.secondary) return;
    if (weapon.fullOrbs >= weapon.maxOrbs + this.extraOrbs) return;
    weapon.addOrb();
    this.emit(sim, 'conjure', { pos: point, burst: { color: '#ff9ee8', count: 8, speed: 150, life: 0.3, size: 2 } });
  }

  // A glowing blue-white blade over the stick while swinging.
  drawBlade(ctx, start) {
    if (!this.swinging) return;
    const end = start + this.weapon.length;
    const from = start + 12;
    ctx.save();
    ctx.fillStyle = EXCALIBUR_GLOW;
    ctx.beginPath();
    ctx.moveTo(from, -9);
    ctx.lineTo(end - 10, -9);
    ctx.lineTo(end + 6, 0);
    ctx.lineTo(end - 10, 9);
    ctx.lineTo(from, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#eefaff';
    ctx.strokeStyle = EXCALIBUR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from, -4.5);
    ctx.lineTo(end - 10, -4.5);
    ctx.lineTo(end, 0);
    ctx.lineTo(end - 10, 4.5);
    ctx.lineTo(from, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crossguard
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(from - 3, -9, 4, 18);
    ctx.restore();
  }
}

// ---- Evoker ---------------------------------------------------------------------

const EVOKER_SHARE = 0.2; // of a pop's damage, for each small orb

export class Evoker extends WandTransformation {
  static id = 'evoker';
  static displayName = 'Evoker';
  static description = `When an orb pops, two half-size orbs appear on the far side of your orbit. They pop for ${EVOKER_SHARE * 100}% damage and don't split again.`;

  drawOver(ctx) {
    looks.drawCowl(ctx, this.owner, this.weapon.time);
  }
  static excludedBy = ['pyromancer'];

  onOrbPop(orb, i, pos, sim) {
    if (orb.small) return;
    const { weapon } = this;
    for (let k = 0; k < 2; k++) {
      if (weapon.orbs.length - weapon.fullOrbs >= weapon.maxSmallOrbs) return;
      // `i` is where the popped orb was; the far side is half the orbit round from there.
      const n = weapon.orbs.length;
      weapon.insertOrb(n === 0 ? 0 : (i + Math.floor(n / 2)) % (n + 1), true, EVOKER_SHARE);
    }
  }
}

// ---- Pyromancer -----------------------------------------------------------------

const FLAME = '#ff8a3d';
const FLAME_CORE = '#ffd23f';
const STEAM = '#a9d6f2';
const MAGMA = '#6b2a12';
const ROCK = '#5a4636';
const ROCK_EDGE = '#2e2219';
const RING_SPIKES = 9; // stone spikes round the ring with Geomancer
const RING_SPIKE_REACH = 0.3; // of Geomancer's spike length, how far past the band they reach
// The ring burns dozens of times a second through any guard, so every bit of
// extra damage counts for far more on it than on a pop: damage upgrades add
// only this share of their usual extra to its burns (Simulation.applySecondaryHit).
export const PYRO_UPGRADE_SCALE = 0.35;

export class Pyromancer extends WandTransformation {
  static id = 'pyromancer';
  static displayName = 'Pyromancer';
  static description = `Your orbs become a ring of fire around you that rapidly burns anyone touching it, a little at a time, through any guard. The more orbs you have built up, the faster it burns. Other elements change the ring. Damage upgrades (Sharpened, Critical Hits, Sabotage, Echo) add only ${PYRO_UPGRADE_SCALE * 100}% as much to the ring.`;

  drawOver(ctx) {
    looks.drawFlameCrown(ctx, this.owner, this.weapon.time);
  }
  static excludedBy = ['evoker'];

  constructor(weapon) {
    super(weapon);
    this.tick = 0.15; // s between burns with one orb; n orbs burn n times as often
    this.share = 0.085; // of the pop damage, per burn
    this.growth = 0.009; // pop damage gained per burn that lands
    this.width = 2; // the ring's half-width, as a share of the orb radius
    this.tickLeft = 1; // share of a burn's wait left
    this.upgradeScale = PYRO_UPGRADE_SCALE;
  }

  apply() {
    const { weapon } = this;
    weapon.orbsTouch = false;
    weapon.elements.fire = true;
    weapon.ring = this;
  }

  // How far the burning band reaches inside (`inner`) and outside (`outer`)
  // the orbit, in px. Geomancer's spikes push the outside further out.
  band() {
    const { weapon, owner } = this;
    const half = weapon.orbRadius * owner.size * this.width;
    const spikes = weapon.spikeLength * owner.size * RING_SPIKE_REACH;
    BAND.inner = half;
    BAND.outer = half + spikes;
    return BAND;
  }

  onUpdate(dt, sim) {
    const { weapon, owner } = this;
    const n = weapon.orbs.length;
    if (n === 0 || sim.over) return;
    this.tickLeft -= (dt * n) / this.tick;
    if (this.tickLeft > 0) return;
    this.tickLeft += 1;
    const ring = weapon.orbitRadius;
    const { inner, outer } = this.band();
    const damage = weapon.popDamage * this.share;
    const hooks = weapon.upgradesWith('onRingBurn');
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive) continue;
      const off = distance(enemy.pos, owner.pos) - ring; // below 0: inside the orbit
      if (off <= -(enemy.radius + inner) || off >= enemy.radius + outer) continue;
      // Quiet: dozens of burns a second, so no damage number or sound for each.
      const dealt = sim.applySecondaryHit(owner, enemy, damage, { reason: 'ring-of-fire', color: FLAME, quiet: true, upgradeScale: this.upgradeScale });
      if (dealt > 0) {
        weapon.popDamage += this.growth;
        for (const upgrade of hooks) if (enemy.alive && !sim.over) upgrade.onRingBurn(enemy, sim);
      }
      if (sim.over) return;
    }
  }

  // A ring of flickering flames; the more orbs, the taller and brighter. The
  // other elements reshape and recolour it: steam on a wavy ring (water),
  // gusts racing round it (air), stone spikes over a magma crust (earth) and
  // flames that wander and change colour (wild).
  drawUnder(ctx) {
    const { weapon, owner } = this;
    const { air, water, earth, wild } = weapon.elements;
    const n = weapon.orbs.length;
    const { x, y } = owner.pos;
    const ring = weapon.orbitRadius;
    const { inner: half, outer } = this.band();
    const heat = Math.min(1, n / weapon.maxOrbs);
    const t = weapon.time;
    ctx.save();

    // Stone spikes, under the band so it covers their roots.
    if (earth) {
      ctx.globalAlpha = 1;
      for (let i = 0; i < RING_SPIKES; i++) {
        const a = weapon.orbitAngle + (i * TAU) / RING_SPIKES;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const root = ring + half * 0.3;
        const tip = ring + outer;
        const w = half * 0.85;
        ctx.fillStyle = ROCK;
        ctx.strokeStyle = ROCK_EDGE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + cos * root - sin * w, y + sin * root + cos * w);
        ctx.lineTo(x + cos * tip, y + sin * tip);
        ctx.lineTo(x + cos * root + sin * w, y + sin * root - cos * w);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // A glowing crack up the middle, hotter with more orbs.
        ctx.strokeStyle = wild ? WILD_COLORS[i % WILD_COLORS.length] : FLAME_CORE;
        ctx.globalAlpha = 0.35 + 0.6 * heat;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + cos * root, y + sin * root);
        ctx.lineTo(x + cos * (root + (tip - root) * 0.7), y + sin * (root + (tip - root) * 0.7));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The band: a magma crust with earth, steam with water, else a glow of
    // fire (red outside, orange, a hot yellow line in the middle). Water
    // makes it wavy.
    const bandPath = () => {
      ctx.beginPath();
      if (water) {
        const steps = 72;
        for (let k = 0; k <= steps; k++) {
          const a = (k * TAU) / steps;
          const r = ring + half * 0.3 * Math.sin(a * 8 + t * 4);
          if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
      } else ctx.arc(x, y, ring, 0, TAU);
    };
    const shift = Math.floor(t * 3);
    bandPath();
    if (earth || water) {
      ctx.globalAlpha = earth ? 0.55 + 0.3 * heat : 0.18 + 0.3 * heat;
      ctx.strokeStyle = earth ? MAGMA : STEAM;
      ctx.lineWidth = half * 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = wild ? WILD_COLORS[shift % WILD_COLORS.length] : looks.FLAME_OUTER;
      ctx.globalAlpha = 0.2 + 0.2 * heat;
      ctx.lineWidth = half * 2.2;
      ctx.stroke();
      ctx.globalAlpha = 0.3 + 0.3 * heat;
      ctx.strokeStyle = looks.FLAME_MID;
      ctx.lineWidth = half * 1.2;
      ctx.stroke();
    }
    ctx.globalAlpha = 0.4 + 0.5 * heat;
    ctx.strokeStyle = looks.FLAME_CORE;
    ctx.lineWidth = Math.max(1.5, half * 0.3);
    ctx.stroke();

    if (n > 0) {
      // The fire: one band per layer (red, orange, a yellow heart), its edges
      // licking up into tongues of flame, outwards and shorter ones inwards;
      // taller with more orbs, rainbow and wandering with wild magic.
      const tongues = 28;
      const step = TAU / tongues;
      for (let layer = 0; layer < 3; layer++) {
        const k = 1 - layer * 0.3;
        ctx.globalAlpha = layer === 0 ? 0.85 : 0.95;
        ctx.fillStyle = wild
          ? WILD_COLORS[(shift + layer * 2) % WILD_COLORS.length]
          : layer === 0 ? looks.FLAME_OUTER : layer === 1 ? looks.FLAME_MID : looks.FLAME_CORE;
        ctx.beginPath();
        for (const dir of [1, -1]) {
          // dir 1: the outer edge; -1: the inner one
          for (let i = 0; i <= tongues; i++) {
            const a = weapon.orbitAngle + i * step;
            const wobble = wild ? half * 0.4 * Math.sin(t * 7 + i * 1.7) : water ? half * 0.3 * Math.sin(a * 8 + t * 4) : 0;
            const base = ring + wobble + dir * half * 0.55 * k;
            const vx = x + Math.cos(a) * base;
            const vy = y + Math.sin(a) * base;
            if (i === 0) {
              ctx.moveTo(vx, vy);
              continue;
            }
            // The tongue between this valley and the last
            const j = i + (dir > 0 ? 0 : 7); // inner tongues flicker out of step
            const flicker = (0.65 + 0.35 * Math.sin(t * 13 + j * 2.1)) * (0.85 + 0.15 * Math.sin(t * 29 + j * 5.3));
            const h = half * (0.8 + 1.4 * heat) * flicker * k * (dir > 0 ? 1 : 0.5);
            const prev = a - step;
            const tipA = a - step / 2 + step * 0.35 * Math.sin(t * 6 + j * 1.3);
            const tipR = base + dir * h;
            const sideR = base + dir * h * 0.2;
            ctx.quadraticCurveTo(x + Math.cos(prev + step * 0.4) * sideR, y + Math.sin(prev + step * 0.4) * sideR, x + Math.cos(tipA) * tipR, y + Math.sin(tipA) * tipR);
            ctx.quadraticCurveTo(x + Math.cos(a - step * 0.4) * sideR, y + Math.sin(a - step * 0.4) * sideR, vx, vy);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }

      // Embers drifting up off it
      ctx.fillStyle = looks.FLAME_CORE;
      const embers = 10;
      for (let i = 0; i < embers; i++) {
        const life = (t * 0.7 + i / embers) % 1;
        const a = weapon.orbitAngle * 0.3 + (i * TAU) / embers + i * 0.7;
        const r = ring + half * (0.8 + 2.4 * life);
        ctx.globalAlpha = (1 - life) * (0.4 + 0.6 * heat);
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.2 + half * 0.08, 0, TAU);
        ctx.fill();
      }

      // Puffs of steam drifting off it.
      if (water) {
        ctx.fillStyle = '#ffffff';
        const puffs = 10;
        for (let i = 0; i < puffs; i++) {
          const life = (t * 0.9 + i / puffs) % 1;
          const a = weapon.orbitAngle * 0.5 + (i * TAU) / puffs + i;
          const r = ring + half * (0.2 + 1.4 * life);
          ctx.globalAlpha = 0.5 * (1 - life) * (0.4 + 0.6 * heat);
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, half * (0.3 + 0.4 * life), 0, TAU);
          ctx.fill();
        }
      }

      // Gusts racing round it, against its spin.
      if (air) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.4 * heat;
        for (let k = 0; k < 3; k++) {
          const a = -weapon.orbitAngle * 2.5 + (k * TAU) / 3;
          const r = ring + half * 0.6 * (k - 1);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1, r), a, a + 1.1);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

const BAND = { inner: 0, outer: 0 }; // reused by Pyromancer.band (read it straight away)

// ---- Aeromancer -----------------------------------------------------------------

const WIND = '#e8f6ff';

export class Aeromancer extends WandTransformation {
  static id = 'aeromancer';
  static displayName = 'Aeromancer';
  static excludedBy = ['magnetism']; // it pulls them back in
  static description = 'Your orbs become airballs: they hit a little softer but blast enemies far away, and anyone blasted takes damage when they slam into a wall. With Pyromancer, the ring blasts away whoever it burns.';

  drawOver(ctx) {
    looks.drawWingedCirclet(ctx, this.owner, this.weapon.time);
  }

  constructor(weapon) {
    super(weapon);
    this.knockback = 2.2; // pop knockback multiplied by this
    this.damage = 0.8; // pop damage multiplied by this
    this.wallDamage = 5;
    this.duration = 1.2; // s a blasted enemy stays airborne
    this.ringGustEvery = 2; // s between Pyromancer's ring gusts
    this.ringGustLeft = 0;
  }

  onUpdate(dt) {
    if (this.ringGustLeft > 0) this.ringGustLeft -= dt;
  }

  apply() {
    const { weapon } = this;
    weapon.popKnockback *= this.knockback;
    weapon.popDamage *= this.damage;
    weapon.elements.air = true;
  }

  onHit(target, sim, damage, point, hit = {}) {
    if (!fromPop(this.weapon, hit) || !target.alive) return;
    target.addStatus(new Airborne({ source: this.owner, duration: this.duration, damage: this.wallDamage }), sim);
  }

  // Pyromancer: a burn blows the enemy away from you, as hard as a pop, and
  // into the next wall, at most once every `ringGustEvery`.
  onRingBurn(enemy, sim) {
    if (this.ringGustLeft > 0 || enemy.hasStatus(Airborne)) return;
    this.ringGustLeft = this.ringGustEvery;
    const { owner } = this;
    const dx = enemy.pos.x - owner.pos.x;
    const dy = enemy.pos.y - owner.pos.y;
    const len = hypot(dx, dy) || 1;
    const speed = enemy.speed * CONFIG.combat.knockback * this.weapon.popKnockback;
    enemy.vel = { x: (dx / len) * speed, y: (dy / len) * speed };
    enemy.addStatus(new Airborne({ source: owner, duration: this.duration, damage: this.wallDamage }), sim);
    this.emit(sim, 'gust', { pos: enemy.pos, burst: { color: WIND, count: 10, speed: 220, life: 0.3, size: 2 } });
  }
}

// Blown off its feet: the next wall it hits hurts, once (Aeromancer).
export class Airborne extends Status {
  constructor({ source, duration, damage }) {
    super({ source, duration });
    this.damage = damage;
    this.landed = false;
  }

  get expired() {
    return this.landed || this.timeLeft <= 0;
  }

  onWallBounce(sim) {
    if (this.landed || sim.over) return;
    this.landed = true;
    sim.dealDamage(this.source, this.ball, this.damage, { reason: 'wall', color: WIND });
  }

  // Wind streaks trailing behind the ball.
  draw(ctx) {
    const { pos, radius, vel } = this.ball;
    const speed = hypot(vel.x, vel.y) || 1;
    const bx = -vel.x / speed;
    const by = -vel.y / speed;
    ctx.save();
    ctx.strokeStyle = WIND;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75 * Math.min(1, this.timeLeft / 0.3);
    for (const offset of [-0.7, 0, 0.7]) {
      const fx = pos.x + bx * (radius + 3) - by * offset * radius;
      const fy = pos.y + by * (radius + 3) + bx * offset * radius;
      const len = 26 - Math.abs(offset) * 12;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + bx * len, fy + by * len);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Hydromancer ----------------------------------------------------------------

const WATER = '#4fb3ff';

export class Hydromancer extends WandTransformation {
  static id = 'hydromancer';
  static displayName = 'Hydromancer';
  static description = 'Your orbs become bubbles that hit 15% harder. Anyone a bubble pops on is soaked for 3s: 30% slower and taking 35% more damage from hits. With Pyromancer, the ring scalds: anyone it burns is soaked more lightly (20% slower, 20% more damage).';

  drawOver(ctx) {
    looks.drawWaveHat(ctx, this.owner, this.weapon.time);
  }

  constructor(weapon) {
    super(weapon);
    this.damage = 1.15; // pop damage multiplied by this
    this.duration = 3;
    this.slow = 0.7; // speed multiplier while soaked
    this.vulnerability = 1.35; // damage taken multiplier while soaked
    // Pyromancer's ring soaks more lightly, but over and over.
    this.ringDuration = 1.5;
    this.ringSlow = 0.75;
    this.ringVulnerability = 1.3;
  }

  apply() {
    this.weapon.popDamage *= this.damage;
    this.weapon.elements.water = true;
  }

  // Pyromancer: a burn soaks too, if they aren't soaked already.
  onRingBurn(enemy, sim) {
    if (enemy.hasStatus(Soaked)) return;
    enemy.addStatus(new Soaked({ source: this.owner, duration: this.ringDuration, slow: this.ringSlow, vulnerability: this.ringVulnerability }), sim);
  }

  onHit(target, sim, damage, point, hit = {}) {
    if (!fromPop(this.weapon, hit) || !target.alive) return;
    target.addStatus(new Soaked({ source: this.owner, duration: this.duration, slow: this.slow, vulnerability: this.vulnerability }), sim);
  }
}

// Dripping wet: slower, and hurt more by weapon hits (Hydromancer).
export class Soaked extends Status {
  constructor({ source, duration, slow, vulnerability }) {
    super({ source, duration });
    this.slow = slow;
    this.vulnerability = vulnerability;
  }

  get speedMultiplier() {
    return this.slow;
  }

  get damageTakenMultiplier() {
    return this.vulnerability;
  }

  // Drops of water running down the ball.
  draw(ctx) {
    const { pos, radius } = this.ball;
    ctx.save();
    ctx.fillStyle = WATER;
    ctx.globalAlpha = 0.8 * Math.min(1, this.timeLeft / 0.4);
    for (let i = 0; i < 4; i++) {
      const fall = (this.age * 0.8 + i * 0.25) % 1;
      const x = pos.x + (i - 1.5) * radius * 0.45;
      const y = pos.y - radius * 0.5 + fall * radius * 1.3;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, TAU);
      ctx.moveTo(x - 2.4, y);
      ctx.lineTo(x, y - 5);
      ctx.lineTo(x + 2.4, y);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Geomancer ------------------------------------------------------------------

export class Geomancer extends WandTransformation {
  static id = 'geomancer';
  static displayName = 'Geomancer';
  static description = 'Your orbs become long stone spikes pointing out from your orbit. They reach much further and hit 25% harder, but shatter in a small burst. With Pyromancer, stone spikes jut from the ring, so it burns further out.';

  drawOver(ctx) {
    looks.drawStoneHelm(ctx, this.owner, this.weapon.time);
  }

  apply() {
    const { weapon } = this;
    weapon.spikeLength = 38;
    weapon.popDamage *= 1.25;
    weapon.blastRadius *= 0.55;
    weapon.elements.earth = true;
  }
}

// ---- Wild Magic -----------------------------------------------------------------

// What a Wild Magic pop can leave on whoever it hits, one at random each
// time: milder versions of other transformations' statuses.
const WILD_EFFECTS = [
  { text: 'BURN', color: '#ff8a3d', make: (source) => new Burning({ source, duration: 2, damage: 1.5, tick: 0.5 }) },
  { text: 'SOAK', color: '#4fb3ff', make: (source) => new Soaked({ source, duration: 2, slow: 0.8, vulnerability: 1.2 }) },
  { text: 'GUST', color: '#e8f6ff', make: (source) => new Airborne({ source, duration: 1, damage: 4 }) },
  { text: 'SHATTER', color: '#c49eff', make: (source) => new GuardBroken({ source, duration: 1.2 }) },
];

export class WildMagic extends WandTransformation {
  static id = 'wild-magic';
  static displayName = 'Wild Magic';
  static description = 'Your orbs wriggle about like worms, wandering far from the orbit, and you can hold one more. Each pop leaves a random effect on whoever it hits: a burn, a soaking, a gust that slams them into the next wall, or a broken guard. With Pyromancer, the ring flickers with colour and hexes whoever it burns about once a second.';

  drawOver(ctx) {
    looks.drawJesterHat(ctx, this.owner, this.weapon.time);
  }

  constructor(weapon) {
    super(weapon);
    this.ringHexEvery = 1; // s between Pyromancer's ring hexes
    this.ringHexLeft = 0;
  }

  apply() {
    const { weapon } = this;
    weapon.wander = 30;
    weapon.maxOrbs += 1;
    weapon.elements.wild = true;
  }

  onUpdate(dt) {
    if (this.ringHexLeft > 0) this.ringHexLeft -= dt;
  }

  onHit(target, sim, damage, point, hit = {}) {
    if (!fromPop(this.weapon, hit) || !target.alive) return;
    this.hex(target, sim);
  }

  // Pyromancer: a burn hexes, at most once every `ringHexEvery`.
  onRingBurn(enemy, sim) {
    if (this.ringHexLeft > 0) return;
    this.ringHexLeft = this.ringHexEvery;
    this.hex(enemy, sim);
  }

  hex(target, sim) {
    const effect = WILD_EFFECTS[Math.floor(Math.random() * WILD_EFFECTS.length)];
    target.addStatus(effect.make(this.owner), sim);
    this.emit(sim, 'hex', { pos: target.pos, text: effect.text, color: effect.color, burst: { color: effect.color, count: 6, speed: 120, life: 0.3, size: 2 } });
  }
}

// ---- Artificer ------------------------------------------------------------------

const MINE = '#ffb36b';

export class Artificer extends WandTransformation {
  static id = 'artificer';
  static displayName = 'Artificer';
  static description = 'Every few seconds, leave an artificial orb behind you. It hangs in the air for 9s and pops for 60% damage on any enemy that touches it.';

  drawOver(ctx) {
    looks.drawTinkerHat(ctx, this.owner, this.weapon.time);
  }

  constructor(weapon) {
    super(weapon);
    this.interval = 3; // s between drops
    this.lifetime = 9; // s a dropped orb lasts
    this.armTime = 0.4; // s before it can pop
    this.share = 0.6; // of a pop's damage
    this.max = 4; // most dropped orbs out at once
    this.dropLeft = this.interval;
    this.mines = []; // { pos, radius, age }
  }

  onUpdate(dt, sim) {
    const { mines } = this;
    for (const mine of mines) mine.age += dt;
    if (mines.length > 0 && mines[0].age >= this.lifetime) mines.shift(); // the oldest is always first
    if (sim.over) return;
    this.dropLeft -= dt;
    if (this.dropLeft <= 0) {
      this.dropLeft = this.interval;
      this.drop(sim);
    }
    for (let i = mines.length - 1; i >= 0; i--) {
      if (mines[i].age >= this.armTime) this.touch(i, sim);
      if (sim.over) return;
    }
  }

  // A new orb just behind the ball, kept inside the walls.
  drop(sim) {
    const { owner, weapon } = this;
    if (this.mines.length >= this.max) this.mines.shift();
    const radius = weapon.orbRadius * owner.size;
    const speed = hypot(owner.vel.x, owner.vel.y) || 1;
    const back = owner.radius + radius + 4;
    const { width, height } = sim.arena;
    const pos = {
      x: Math.min(width - radius, Math.max(radius, owner.pos.x - (owner.vel.x / speed) * back)),
      y: Math.min(height - radius, Math.max(radius, owner.pos.y - (owner.vel.y / speed) * back)),
    };
    this.mines.push({ pos, radius, age: 0 });
    this.emit(sim, 'drop', { pos, burst: { color: MINE, count: 5, speed: 80, life: 0.25, size: 1.8 } });
  }

  // Dropped orb `i` pops on an enemy ball, or is knocked out by an enemy's guard.
  touch(i, sim) {
    const { owner, weapon } = this;
    const mine = this.mines[i];
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      const gap = distance(enemy.pos, mine.pos);
      if (gap < enemy.radius + mine.radius) {
        this.mines.splice(i, 1);
        weapon.blast(mine.pos, 1, this.share, sim);
        return;
      }
      if (gap > Math.max(enemy.weapon.guardReach, enemy.radius) + mine.radius) continue;
      const hit = projectileBlockedBy(weapon, mine.pos, mine.pos, enemy, mine.radius, weapon.swattable);
      if (hit) {
        this.mines.splice(i, 1);
        if (hit.drone) enemy.weapon.swat(hit.drone, owner, hit.point, sim);
        this.emit(sim, 'fizzle', { pos: mine.pos, burst: { color: MINE, count: 6, speed: 90, life: 0.25, size: 1.8 } });
        return;
      }
    }
  }

  onGrow(factor) {
    for (const mine of this.mines) mine.radius *= factor;
  }

  // Orange-gold orbs with a ticking ring, fading out at the end.
  drawUnder(ctx) {
    if (this.mines.length === 0) return;
    ctx.save();
    for (const { pos, radius, age } of this.mines) {
      const fade = Math.min(1, (this.lifetime - age) / 1);
      const armed = age >= this.armTime;
      ctx.globalAlpha = 0.35 * fade;
      ctx.fillStyle = MINE;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 1.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = (armed ? 0.95 : 0.5) * fade;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#fff4dc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 0.6, age * 4, age * 4 + Math.PI * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
