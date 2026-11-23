import { Ability } from './Ability.js';
import { reflectDamage, reflectedBy } from '../sim/reflect.js';
import { add, angleOf, closestPointOnSegment, distance, fromAngle, normalize, scale, sub, turnTowards } from '../sim/math.js';

const WAVE = '#bfe6ff';
const SAW = '#e3e8ee';
const ARC_RADIUS = 60; // px, the curve the crescent is drawn on (at size 1)

// Daggers (Swashbuckler): in place of Backstab, a slash that sends a crescent
// wave flying at the nearest enemy. The wave goes straight on until it has
// flown `range` px or left the arena, hitting each enemy it passes through
// once, as a Backstab would: a guaranteed crit with the usual knockback. The
// hits are the weapon's own (they grow the Daggers, Lifesteal sees them...).
//
// With `saw` (Swashbuckler with Saw) the wave is a sawing one: it homes in
// on its target fast, slows to a grind once it's close, and hits whoever it
// overlaps every `sawInterval` s at the saw's damage, crits rolled as usual,
// without knocking them about. It lasts `sawTime` s rather than a range.
//
// The ability stays active while the wave flies, so the cooldown counts from
// when it's gone. A parrying ball stops the wave and sends its damage back.
export class CutlassWave extends Ability {
  static displayName = 'Cutlass Wave';

  constructor(weapon, { saw = false } = {}) {
    super(weapon, { cooldown: saw ? 7 : 6 });

    // Stats. Upgrades may change these.
    this.saw = saw;
    this.triggerRange = 420; // px; only slashes when an enemy is this close
    this.speed = saw ? 800 : 760; // px/s
    this.range = 560; // px the plain wave flies before fading
    this.sawTime = 0.8; // s the saw wave lasts
    this.grindSpeed = 200; // px/s the saw slows to near its target
    this.grindRange = 60; // px from the target's edge where it starts slowing
    this.homing = 8; // rad/s the saw wave turns towards its target
    this.braking = 12; // how quickly it reaches its new speed (per second)
    this.halfWidth = saw ? 55 : 42; // px either side of its middle (grows with the ball)
    this.thickness = 8; // px hitbox half-width
    this.sawDamageMultiplier = 0.4; // each tooth is a nick, as with Sawblade
    this.sawInterval = 0.1; // s between two saw hits on the same ball

    this.wave = null; // { pos, dir, speed, target, halfWidth, travelled, time, hit: Map(ball -> s until it can be hit again) }
    this.striking = false; // true while the wave's hit is being dealt
  }

  get guaranteesCrit() {
    return this.striking && !this.saw;
  }

  get damageMultiplier() {
    return this.striking && this.saw ? this.sawDamageMultiplier : 1;
  }

  // The saw leaves the enemy's movement alone (see Simulation.applyHit).
  get knockbackMultiplier() {
    return this.striking && this.saw ? 0 : 1;
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    const { owner, weapon } = this;
    const target = this.nearestEnemy(sim);
    const time = distance(owner.pos, target.pos) / this.speed;
    const dir = normalize(sub(add(target.pos, scale(target.vel, time)), owner.pos));
    weapon.angle = angleOf(dir);
    this.wave = {
      pos: add(owner.pos, scale(dir, owner.radius + weapon.gap)),
      dir,
      speed: this.speed,
      target,
      halfWidth: this.halfWidth * owner.size,
      travelled: 0,
      time: 0,
      hit: new Map(),
    };
    this.emit(sim, 'swipe', { shake: 2, burst: { color: this.saw ? SAW : WAVE, count: 12, speed: 200, life: 0.3, size: 2 } });
  }

  // The wave's front edge, across its path, in arena coordinates.
  segment() {
    const { pos, dir, halfWidth } = this.wave;
    const across = { x: -dir.y * halfWidth, y: dir.x * halfWidth };
    return { a: sub(pos, across), b: add(pos, across) };
  }

  onUpdate(dt, sim) {
    const wave = this.wave;
    if (this.saw) this.steer(wave, dt);
    const step = wave.speed * dt;
    wave.pos = add(wave.pos, scale(wave.dir, step));
    wave.travelled += step;
    wave.time += dt;
    const { a, b } = this.segment();
    const { width, height } = sim.arena;
    const spent = this.saw ? wave.time >= this.sawTime : wave.travelled >= this.range;
    if (sim.over || spent || outside(wave.pos, width, height)) {
      this.end(sim);
      return;
    }

    const reflector = reflectedBy(sim, this.owner, a, b);
    if (reflector) {
      const damage = this.weapon.getDamage() * (this.saw ? this.sawDamageMultiplier : this.weapon.critMultiplier);
      sim.dealDamage(reflector, this.owner, reflectDamage(reflector, damage), { reason: 'reflect', color: WAVE });
      this.end(sim);
      return;
    }

    for (const [ball, time] of wave.hit) {
      if (time !== Infinity) wave.hit.set(ball, time - dt);
    }
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner || (wave.hit.get(enemy) ?? 0) > 0) continue;
      const near = closestPointOnSegment(enemy.pos, a, b);
      if (distance(near, enemy.pos) >= enemy.radius + this.thickness) continue;
      wave.hit.set(enemy, this.saw ? this.sawInterval : Infinity);
      this.strike(enemy, near, sim);
      if (sim.over) break;
    }
  }

  // The saw wave turns towards where its target will be, flat out while it's
  // far, easing down to a grind once it's close.
  steer(wave, dt) {
    const { target } = wave;
    if (!target?.alive) return;
    const gap = distance(wave.pos, target.pos) - target.radius;
    const lead = add(target.pos, scale(target.vel, Math.max(0, gap) / wave.speed));
    const want = angleOf(sub(lead, wave.pos));
    wave.dir = fromAngle(turnTowards(angleOf(wave.dir), want, this.homing * dt));
    const speed = gap <= this.grindRange * this.owner.size ? this.grindSpeed : this.speed;
    wave.speed += (speed - wave.speed) * Math.min(1, this.braking * dt);
  }

  // One hit from the wave on `enemy`, landing on the side of it facing `near`.
  strike(enemy, near, sim) {
    const away = sub(near, enemy.pos);
    const side = away.x || away.y ? normalize(away) : scale(this.wave.dir, -1);
    enemy.clearHitCooldown(this.weapon);
    this.striking = true;
    sim.applyHit(this.owner, enemy, add(enemy.pos, scale(side, enemy.radius)));
    this.striking = false;
  }

  onEnd() {
    this.wave = null;
  }

  // A pale crescent bowed forward, or a toothed grey one for the saw.
  draw(ctx) {
    if (!this.wave) return;
    const { pos, dir, halfWidth } = this.wave;
    const r = ARC_RADIUS * this.owner.size;
    const centre = sub(pos, scale(dir, r));
    const half = Math.min(1.4, halfWidth / r);
    const heading = angleOf(dir);
    const fade = this.saw ? Math.min(1, (this.sawTime - this.wave.time) / 0.3) : Math.min(1, (this.range - this.wave.travelled) / 120);
    ctx.save();
    ctx.globalAlpha = 0.85 * fade;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.saw ? SAW : WAVE;
    ctx.lineWidth = this.thickness * 1.6 * this.owner.size;
    if (this.saw) ctx.setLineDash([6 * this.owner.size, 5 * this.owner.size]);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r, heading - half, heading + half);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * this.owner.size;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r, heading - half * 0.8, heading + half * 0.8);
    ctx.stroke();
    ctx.restore();
  }
}

function outside({ x, y }, width, height) {
  return x < 0 || y < 0 || x > width || y > height;
}
