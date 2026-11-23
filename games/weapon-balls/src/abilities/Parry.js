import { Ability } from './Ability.js';
import { TAU, angleOf, fromAngle, hypot, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';
import { CONFIG } from '../config.js';
import { jitter } from '../sim/timing.js';

const GUARD = '#bfe6ff';
const FLASH_TIME = 0.25; // s the crossing of the daggers flashes at the start of a parry
const SHOW = 1.7; // how much bigger than life the daggers are drawn while parrying

const ease = (t) => 1 - Math.pow(1 - t, 3);

// Stop dead and cross the daggers in front of the ball. Anything that hits the
// ball while they are crossed (a blade, a bullet, a boomerang, a blast...) does
// no damage (and bullets that come near it are sent back at the shooter): it builds up, and goes off when the guard runs out (or at once if
// a hit about as big as the enemies' usual one has been stopped). Then the ball dashes at whoever it was (invincible for the whole
// counter) and whips two huge arcs out, which always land for 125% of the damage
// that was stopped.
// The real blades are out of the way meanwhile (the weapon counts as
// `disarmed`, so enemy weapons pass through them and reach the ball) and the
// ability draws its own. The weapon keeps spinning underneath.
//
// Phases: 'guard' (still, crossed, waiting for a hit) -> 'swipe' (the counter
// plays out, and lands partway through). A parry nobody hit just runs out.
export class Parry extends Ability {
  static displayName = 'Parry';

  constructor(weapon) {
    super(weapon, { cooldown: 6 });

    // Stats. Upgrades may change these.
    this.guardTime = 0.8; // s the daggers stay crossed
    this.counterMultiplier = 1.25; // of the damage the parry stopped
    this.swipeTime = 0.4; // s the counter takes to play out
    this.impactAt = 0.45; // fraction of the swipe at which the arcs land
    this.swipeArc = 2.6; // radians each of the two arcs sweeps through
    this.burstFactor = 0.9; // the counter goes off early once the stopped damage reaches this x the enemies' average hit (see burstDamage)
    this.minBurst = 3; // but never less than this (about a Spear's hit), so a weak hitter always has to build up
    this.whiffRefund = 0.65; // share of the cooldown given back when nothing was parried
    this.triggerRange = 190; // px; only parries when an enemy is within this distance
    this.aimTurnRate = 20; // rad/s the crossed daggers turn to face the enemy
    this.dashSpeed = 1100; // px/s of the dash at the source once a hit is stopped
    this.dashRange = 170; // px; the most it dashes, stopping early on reaching them

    this.phase = null; // 'guard' | 'swipe'
    this.timer = 0;
    this.elapsed = 0; // s since the parry started
    this.stopped = 0; // damage stopped so far, to be returned
    this.source = null; // the ball behind the biggest hit stopped so far: where the counter goes
    this.biggest = 0; // damage of that hit
    this.landed = false; // the counter has hit yet
    this.parried = false; // anything was stopped or reflected this parry
    this.swipeAngle = 0; // direction of the counter
    this.guardAngle = 0; // where the crossed daggers point
    this.dashed = 0; // px dashed so far in this swipe
  }

  // The ball stands still from the moment it parries until the counter is done.
  get controlsMovement() {
    return this.active;
  }

  // The real blades are out of the way while the ability draws its own.
  get disarmed() {
    return this.active;
  }

  // Stopped damage that sets the counter off without waiting out the guard: a
  // share of the damage the enemies' weapons deal per hit right now, averaged
  // over every enemy, so it grows as they scale, with a floor of `minBurst`. Big hitters go off at once;
  // weak ones (Drone) have to build up.
  burstDamage(sim) {
    let total = 0;
    let count = 0;
    for (const ball of sim.aliveBalls) {
      if (ball === this.owner) continue;
      total += ball.weapon.getDamage();
      count += 1;
    }
    return count ? Math.max(this.minBurst, (this.burstFactor * total) / count) : Infinity;
  }

  // Bullets that come this close to the ball (px beyond its surface) are sent back at the shooter.
  get reflectRadius() {
    return this.active ? this.weapon.length * SHOW * 0.9 : 0;
  }

  // A bullet was sent back (see Gun.reflect).
  onProjectileReflected(point, sim) {
    this.parried = true;
    this.emit(sim, 'deflect', { shake: 2, burst: { color: '#ffffff', count: 8, speed: 260, life: 0.25, size: 3 }, pos: point });
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    this.phase = 'guard';
    this.guardAngle = this.weapon.angle;
    this.timer = this.guardTime;
    this.elapsed = 0;
    this.stopped = 0;
    this.source = null;
    this.biggest = 0;
    this.landed = false;
    this.parried = false;
    this.owner.vel = vec(0, 0);
    this.owner.flash = FLASH_TIME;
    this.emit(sim, 'guard', { shake: 2, burst: { color: GUARD, count: 18, speed: 260, life: 0.35, size: 3 }, pos: this.crossPoint() });
  }

  // Called for every hit that would damage the ball (see Simulation.applyHit and
  // dealDamage). True = stopped: the damage is stored for the counter. `source`
  // is the ball behind the hit.
  absorbDamage(source, damage, sim) {
    if (!source?.alive || source === this.owner) return false;
    if (this.phase === 'swipe') return true; // invincible while the counter plays out
    if (this.phase !== 'guard') return false;
    this.stopped += damage;
    this.parried = true;
    if (damage > this.biggest) {
      this.biggest = damage;
      this.source = source;
    }
    this.emit(sim, 'deflect', { shake: 3, hitstop: 0.06, burst: { color: '#ffffff', count: 16, speed: 300, life: 0.3, size: 3 }, pos: this.crossPoint() });
    return true;
  }

  onUpdate(dt, sim) {
    const { owner } = this;
    owner.vel = vec(0, 0);
    this.elapsed += dt;
    this.timer -= dt;

    if (this.phase === 'swipe') {
      if (!this.landed) this.dash(sim);
      if (!this.landed && this.timer <= this.swipeTime * (1 - this.impactAt)) this.land(sim);
      if (this.timer <= 0) this.end(sim);
      return;
    }

    // Weak hits build up and go off together when the guard runs out; a hit
    // big enough to reach `burstDamage` sets it off straight away.
    if (this.stopped > 0 && (this.timer <= 0 || this.stopped >= this.burstDamage(sim))) {
      this.source = this.source?.alive ? this.source : this.nearestEnemy(sim);
      if (this.source) this.startSwipe(sim);
      else this.end(sim);
      return;
    }

    const enemy = this.nearestEnemy(sim);
    if (enemy) this.guardAngle = turnTowards(this.guardAngle, angleOf(sub(enemy.pos, owner.pos)), this.aimTurnRate * dt);
    if (this.timer <= 0) this.endWhiff(sim);
  }

  // The guard ran out with nothing parried: most of the cooldown comes back.
  endWhiff(sim) {
    const refund = !this.parried;
    this.end(sim);
    if (refund) this.cooldownLeft = jitter(this.cooldown * (1 - this.whiffRefund));
  }

  startSwipe(sim) {
    const { owner, source } = this;
    this.phase = 'swipe';
    this.timer = this.swipeTime;
    this.swipeAngle = angleOf(sub(source.pos, owner.pos));
    this.dashed = 0;
    this.emit(sim, 'riposte', { burst: { color: GUARD, count: 12, speed: 200, life: 0.3, size: 3 } });
  }

  // A short dash at the source until the arcs land, stopping when they're reached.
  dash(sim) {
    const { owner, source } = this;
    if (!source.alive) return;
    const to = sub(source.pos, owner.pos);
    this.swipeAngle = angleOf(to);
    const gap = hypot(to.x, to.y) - owner.radius - source.radius;
    if (gap <= 4 || this.dashed >= this.dashRange) return;
    owner.vel = fromAngle(this.swipeAngle, this.dashSpeed);
    this.dashed += this.dashSpeed / CONFIG.physicsHz;
  }

  // The arcs land, whatever the distance: the counter can't be dodged or blocked.
  land(sim) {
    const { owner, weapon, source } = this;
    this.landed = true;
    owner.vel = vec(0, 0);
    const damage = this.stopped * this.counterMultiplier;
    this.emit(sim, 'impact', { shake: 9, hitstop: 0.1, burst: { color: '#ffffff', count: 30, speed: 420, life: 0.45, size: 4 }, pos: source.pos });
    if (sim.over || !source.alive) return;

    const before = source.hp;
    sim.dealDamage(owner, source, damage, { reason: 'riposte', color: GUARD });
    const away = sub(source.pos, owner.pos);
    source.vel = scale(away.x || away.y ? normalize(away) : fromAngle(this.swipeAngle, 1), source.speed * CONFIG.combat.knockback);
    if (source.hp < before || !source.alive) weapon.registerHit(source, sim, damage, source.pos);
  }

  onEnd() {
    this.phase = null;
    this.source = null;
    this.stopped = 0;
    this.biggest = 0;
  }

  // Where the daggers cross, in front of the ball.
  crossPoint() {
    const { owner, weapon } = this;
    const reach = owner.radius + weapon.gap + weapon.length * 0.45 * SHOW;
    return { x: owner.pos.x + Math.cos(this.guardAngle) * reach, y: owner.pos.y + Math.sin(this.guardAngle) * reach };
  }

  drawOver(ctx) {
    if (!this.active) return;
    if (this.phase === 'swipe') {
      if (!this.landed) this.drawDash(ctx);
      this.drawSwipe(ctx);
    }
    else this.drawGuard(ctx);
  }

  // Afterimages along the dash.
  drawDash(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = GUARD;
    for (let i = 1; i <= 4; i++) {
      const behind = scale(owner.vel, -0.012 * i);
      ctx.globalAlpha = 0.35 * (1 - i / 5);
      ctx.beginPath();
      ctx.arc(owner.pos.x + behind.x, owner.pos.y + behind.y, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawGuard(ctx) {
    const { owner, weapon } = this;
    const c = this.crossPoint();
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 22);
    ctx.save();

    // A glow round the ball and the window left as a ring.
    ctx.fillStyle = GUARD;
    ctx.globalAlpha = Math.min(0.6, 0.14 + 0.1 * pulse + 0.05 * this.stopped);
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 14, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = GUARD;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 10, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, this.timer / this.guardTime));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Shockwave as the parry starts.
    if (this.elapsed < FLASH_TIME * 1.6) {
      const t = this.elapsed / (FLASH_TIME * 1.6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * (1 - t);
      ctx.globalAlpha = 0.8 * (1 - t);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 15 + 70 * ease(t), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Two daggers crossed in an X, bigger than life.
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(this.guardAngle + side * 0.75);
      ctx.scale(SHOW, SHOW * weapon.widthScale);
      weapon.drawBladeAt(ctx, -weapon.length / 2);
      ctx.restore();
    }

    // The flash as they cross.
    if (this.elapsed < FLASH_TIME) {
      const t = this.elapsed / FLASH_TIME;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95 * (1 - t);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 14 + 26 * t, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const arm = 18 + 40 * t;
        ctx.moveTo(c.x - Math.cos(a) * arm, c.y - Math.sin(a) * arm);
        ctx.lineTo(c.x + Math.cos(a) * arm, c.y + Math.sin(a) * arm);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // A crescent along a circle of `radius`: `width` thick at angle `head`,
  // narrowing to a point `trail` radians further round. Filled in one go.
  crescent(ctx, radius, head, trail, width, color, alpha) {
    const { x, y } = this.owner.pos;
    const steps = 40;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= steps; i++) {
        const t = pass === 0 ? i / steps : 1 - i / steps;
        const r = radius + ((pass === 0 ? 1 : -1) * width * (1 - t) ** 0.8) / 2;
        const a = head + trail * t;
        if (i === 0 && pass === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  // Two huge arcs, one from each side, sweeping through each other towards the source.
  drawSwipe(ctx) {
    const { owner, weapon } = this;
    const progress = Math.min(1, 1 - this.timer / this.swipeTime);
    const sweep = ease(Math.min(1, progress / this.impactAt));
    const fade = progress < this.impactAt ? 1 : Math.max(0, 1 - (progress - this.impactAt) / (1 - this.impactAt));
    const inner = owner.radius + weapon.gap;
    const radius = inner + weapon.length * SHOW * 0.9;
    const half = this.swipeArc / 2;
    ctx.save();
    for (const side of [-1, 1]) {
      // Each head runs from its own side across to the other, ending a little past the middle.
      const head = this.swipeAngle + side * half - side * (this.swipeArc + 0.4) * sweep;
      const trail = side * this.swipeArc * 0.7 * Math.min(1, sweep * 1.5);
      // One solid crescent: full width at the head, thinning to a point at the tail.
      this.crescent(ctx, radius, head, trail, weapon.length * SHOW, GUARD, 0.55 * fade);
      this.crescent(ctx, radius, head, trail * 0.8, weapon.length * SHOW * 0.45, '#ffffff', 0.8 * fade);
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(owner.pos.x, owner.pos.y);
      ctx.rotate(head);
      ctx.scale(SHOW, SHOW * weapon.widthScale);
      weapon.drawLocal(ctx, inner / SHOW);
      ctx.restore();
    }

    // A flash where the counter lands.
    const hit = progress - this.impactAt;
    if (hit >= 0 && hit < 0.25) {
      const t = hit / 0.25;
      const to = fromAngle(this.swipeAngle, radius);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9 * (1 - t);
      ctx.beginPath();
      ctx.arc(owner.pos.x + to.x, owner.pos.y + to.y, 20 + 40 * t, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
