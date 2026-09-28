import { Upgrade } from './Upgrade.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { OffhandSword } from '../weapons/OffhandSword.js';
import { Status } from '../sim/Status.js';
import { TAU, add, angleOf, distance, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';

// Transformations for the Sword: big upgrades that change how it fights. They
// can be combined with each other and with the small upgrades, and are applied
// before the small ones (see Upgrade.transformation), so e.g. Big Shield also
// grows the extra shield from Stalwart.

class SwordTransformation extends Upgrade {
  static weapons = ['sword'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Stalwart -------------------------------------------------------------------

const Y_ARM = 0.6; // radians either side of straight behind the sword
const STALWART_WIDTH = 0.7; // each shield's width, as a share of the one it started with
const STALWART_SPIN = 0.85; // the extra weight slows the sword's spin

export class Stalwart extends SwordTransformation {
  static id = 'stalwart';
  static displayName = 'Stalwart';
  static description = 'Gain a second, smaller shield. Both sit behind you in a Y, with your sword as its stem. The weight slows your spin by 15%.';

  apply() {
    this.weapon.spinSpeed *= STALWART_SPIN;
    const { shields } = this.weapon;
    if (shields.length === 0) return;
    shields[0].width *= STALWART_WIDTH;
    const extra = shields[0].clone();
    shields.push(extra);
    shields[0].offset = Math.PI - Y_ARM;
    extra.offset = Math.PI + Y_ARM;
  }
}

// ---- Wildling -------------------------------------------------------------------

const WARD_COLOR = '#7ee081';

export class Wildling extends SwordTransformation {
  static id = 'wildling';
  static displayName = 'Wildling';
  static description = 'Landing a hit with Spin Swipe wards you: the next hit you take does nothing.';

  constructor(weapon) {
    super(weapon);
    this.warded = false; // one ward at a time; more spin hits don't add another
    this.time = 0; // for the pulsing ring
  }

  onUpdate(dt) {
    this.time += dt;
  }

  onHit(target, sim) {
    if (!(this.ability instanceof SpinSwipe) || !this.ability.active || this.warded) return;
    this.warded = true;
    this.emit(sim, 'ward', { text: 'WARD', color: WARD_COLOR, burst: { color: WARD_COLOR, count: 10, speed: 140, life: 0.4 } });
  }

  preventHit(attackerWeapon, sim) {
    if (!this.warded) return false;
    this.warded = false;
    this.emit(sim, 'absorb', { shake: 3, text: 'WARDED', color: WARD_COLOR, burst: { color: WARD_COLOR, count: 18, speed: 260, life: 0.45 } });
    return true;
  }

  // A pulsing green ring while the ward is up.
  drawOver(ctx) {
    if (!this.warded) return;
    const { owner } = this;
    ctx.save();
    ctx.strokeStyle = WARD_COLOR;
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 8);
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 6, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Dizzy ----------------------------------------------------------------------

const STARS = 3;

export class Dizzy extends SwordTransformation {
  static id = 'dizzy';
  static displayName = 'Dizzy';
  static description = 'Spin Swipe spins two extra full turns.';

  apply() {
    if (this.ability instanceof SpinSwipe) this.ability.turns += 2;
  }

  // Little stars circling the ball while it spins.
  drawOver(ctx) {
    const { ability, owner } = this;
    if (!(ability instanceof SpinSwipe) || !ability.active) return;
    ctx.save();
    ctx.fillStyle = '#ffe066';
    for (let i = 0; i < STARS; i++) {
      const a = -ability.rotated * 0.6 + (i * TAU) / STARS;
      const p = add(owner.pos, { x: Math.cos(a) * owner.radius * 0.7, y: Math.sin(a) * owner.radius * 0.3 - owner.radius - 8 });
      drawStar(ctx, p, 5);
    }
    ctx.restore();
  }
}

function drawStar(ctx, { x, y }, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const d = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

// ---- Captain --------------------------------------------------------------------

const THROWN_SPIN = 14; // rad/s the thrown shield turns while flying

export class Captain extends SwordTransformation {
  static id = 'captain';
  static displayName = 'Captain';
  static description = "Every 4 s, throw your shield at the enemy for 2 damage (plus its own contact damage, like spikes). It flies back to you, but can't block while it's away.";

  constructor(weapon) {
    super(weapon);
    this.interval = 4; // s between throws
    this.damage = 2;
    this.throwSpeed = 620; // px/s
    this.returnSpeed = 720; // px/s
    this.range = 360; // px it flies out before turning back if it hits nothing
    this.triggerRange = 320; // px; only throws when an enemy is this close
    this.cooldownLeft = this.interval / 2;

    this.phase = null; // null (in hand) | 'out' | 'back'
    this.shield = null; // the one being thrown
    this.pos = vec();
    this.vel = vec();
    this.travelled = 0;
    this.spin = 0;
  }

  onUpdate(dt, sim) {
    if (this.phase === null) {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0 && !sim.over) this.tryThrow(sim);
      return;
    }

    this.spin += THROWN_SPIN * dt;
    if (this.phase === 'out') {
      this.pos = add(this.pos, scale(this.vel, dt));
      this.travelled += this.throwSpeed * dt;
      const target = sim.over ? null : touchedEnemy(sim, this.owner, this.pos, this.shield.width / 2);
      if (target) {
        const damage = this.damage + this.shield.contactDamage;
        sim.dealDamage(this.owner, target, damage, { reason: 'shield-throw', color: '#ffd966' });
        this.phase = 'back';
      } else if (this.travelled >= this.range || outsideArena(this.pos, sim.arena)) {
        this.phase = 'back';
      }
      return;
    }

    // Flying back: home in on the owner and snap back into place on arrival.
    const step = this.returnSpeed * dt;
    const toOwner = sub(this.owner.pos, this.pos);
    if (distance(this.owner.pos, this.pos) <= this.owner.radius + step) {
      this.shield.away = false;
      this.shield = null;
      this.phase = null;
      this.emit(sim, 'catch');
      return;
    }
    this.pos = add(this.pos, scale(normalize(toOwner), step));
  }

  tryThrow(sim) {
    const shield = this.weapon.heldShields[0];
    const enemy = this.nearestEnemy(sim);
    if (!shield || !enemy || distance(enemy.pos, this.owner.pos) > this.triggerRange) return;

    const { a, b } = shield.getSegment();
    this.shield = shield;
    shield.away = true;
    this.pos = scale(add(a, b), 0.5);
    this.vel = scale(leadDirection(this.pos, enemy, this.throwSpeed), this.throwSpeed);
    this.travelled = 0;
    this.spin = shield.angle;
    this.phase = 'out';
    this.cooldownLeft = this.interval;
    this.emit(sim, 'throw');
  }

  drawOver(ctx) {
    if (this.phase) this.shield.drawThrown(ctx, this.pos, this.spin);
  }
}

// ---- Fire Eater -----------------------------------------------------------------

const FIRE = '#ff8a3d';
const FIRE_CORE = '#ffd23f';

export class FireEater extends SwordTransformation {
  static id = 'fire-eater';
  static displayName = 'Fire Eater';
  static description = 'Every 3 s your blade catches fire. Your next hit sets the enemy burning for 1 damage every 0.5 s for 3 s.';

  constructor(weapon) {
    super(weapon);
    this.igniteTime = 3; // s after the last burning hit before the blade lights again
    this.burnDamage = 1; // per tick
    this.burnTick = 0.5; // s
    this.burnDuration = 3; // s
    this.timer = this.igniteTime;
    this.lit = false;
    this.time = 0; // for the flicker
  }

  onUpdate(dt, sim) {
    this.time += dt;
    if (this.lit) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.lit = true;
    this.emit(sim, 'ignite', { burst: { color: FIRE, count: 8, speed: 120, life: 0.35 } });
  }

  onHit(target, sim) {
    if (!this.lit) return;
    this.lit = false;
    this.timer = this.igniteTime;
    const { burnDamage: damage, burnTick: tick, burnDuration: duration } = this;
    target.addStatus(new Burning({ source: this.owner, duration, damage, tick }), sim);
  }

  // Flames licking along the blade while it's lit.
  drawBlade(ctx, start) {
    if (!this.lit) return;
    const len = this.weapon.length;
    const tongues = 6;
    ctx.save();
    for (let i = 0; i < tongues; i++) {
      const x = start + 18 + ((len - 24) * i) / (tongues - 1);
      const h = 9 + 5 * Math.sin(this.time * 22 + i * 1.7);
      for (const side of [-1, 1]) {
        ctx.fillStyle = FIRE;
        flame(ctx, x, 4 * side, h * side, 5);
        ctx.fillStyle = FIRE_CORE;
        flame(ctx, x, 4 * side, h * 0.55 * side, 3);
      }
    }
    ctx.restore();
  }
}

// One flame tongue: base centred on (x, y), tip `h` px away along y.
function flame(ctx, x, y, h, halfWidth) {
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, y);
  ctx.quadraticCurveTo(x - halfWidth * 0.4, y + h * 0.6, x + halfWidth * 0.3, y + h);
  ctx.quadraticCurveTo(x + halfWidth * 0.6, y + h * 0.5, x + halfWidth, y);
  ctx.closePath();
  ctx.fill();
}

// Damage over time from Fire Eater. Hits land on a fixed count of ticks, so
// float drift can't add or lose one.
export class Burning extends Status {
  constructor({ source, duration, damage, tick }) {
    super({ source, duration });
    this.damage = damage;
    this.tick = tick;
    this.tickLeft = tick;
    this.ticksLeft = Math.round(duration / tick);
  }

  get expired() {
    return this.ticksLeft <= 0;
  }

  onUpdate(dt, sim) {
    this.tickLeft -= dt;
    if (this.tickLeft > 0) return;
    this.tickLeft += this.tick;
    this.ticksLeft -= 1;
    if (!sim.over) sim.dealDamage(this.source, this.ball, this.damage, { reason: 'burn', color: FIRE });
  }

  // Flames flickering up around the ball.
  draw(ctx) {
    const { pos, radius } = this.ball;
    const tongues = 7;
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < tongues; i++) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / tongues; // across the top half
      const base = add(pos, fromAngle(a, radius - 3));
      const h = 10 + 6 * Math.sin(this.age * 20 + i * 2.3);
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = FIRE;
      flame(ctx, 0, 0, -h, 5);
      ctx.fillStyle = FIRE_CORE;
      flame(ctx, 0, 0, -h * 0.5, 2.5);
      ctx.restore();
    }
    ctx.restore();
  }
}

// ---- Piercer --------------------------------------------------------------------

export class Piercer extends SwordTransformation {
  static id = 'piercer';
  static displayName = 'Piercer';
  static description = "After every Spin Swipe, lunge at the enemy sword-first for a big stab. Spin Swipe's cooldown is 50% longer.";

  constructor(weapon) {
    super(weapon);
    this.aimTime = 0.4; // s stopped while turning the sword on the enemy
    this.aimTurnRate = 25; // rad/s
    this.lungeSpeed = 750; // px/s
    this.lungeDuration = 0.2; // s, if it doesn't hit first
    this.lungeDamageMultiplier = 1.5;
    this.lungeKnockbackMultiplier = 1.8;
    this.recoil = 0.3; // fraction of lunge speed kept after landing the stab
    this.triggerRange = 250; // px; no lunge if the enemy is further away than this when the spin ends
    this.cooldownPenalty = 0.5; // Spin Swipe's cooldown is this much longer, since every spin now ends in a stab

    this.phase = null; // null | 'aim' | 'lunge'
    this.timer = 0;
    this.target = null;
  }

  apply() {
    const { ability } = this;
    if (!(ability instanceof SpinSwipe)) return;
    ability.cooldown *= 1 + this.cooldownPenalty;
    ability.cooldownLeft *= 1 + this.cooldownPenalty;
  }

  get spinMultiplier() {
    return this.phase ? 0 : 1;
  }

  get damageMultiplier() {
    return this.phase === 'lunge' ? this.lungeDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'lunge' ? this.lungeKnockbackMultiplier : 1;
  }

  get controlsMovement() {
    return this.phase !== null;
  }

  onAbilityEnd(ability, sim) {
    if (!(ability instanceof SpinSwipe) || sim.over) return;
    const enemy = this.nearestEnemy(sim);
    if (!enemy || distance(enemy.pos, this.owner.pos) > this.triggerRange) return;
    this.target = enemy;
    this.phase = 'aim';
    this.timer = this.aimTime;
  }

  onUpdate(dt, sim) {
    if (!this.phase) return;
    const { owner, weapon } = this;
    this.timer -= dt;

    if (this.phase === 'aim') {
      owner.vel = vec(0, 0);
      if (this.target.alive) weapon.angle = turnTowards(weapon.angle, angleOf(sub(this.target.pos, owner.pos)), this.aimTurnRate * dt);
      if (this.timer <= 0) {
        this.phase = 'lunge';
        this.timer = this.lungeDuration;
        owner.vel = fromAngle(weapon.angle, this.lungeSpeed);
        // The spin probably just hit them; the stab is a separate attack.
        this.target.clearHitCooldown(weapon);
        this.emit(sim, 'lunge', { shake: 3 });
      }
      return;
    }

    // Lunging: hold full speed, follow wall bounces, keep the sword pointing forward.
    owner.vel = scale(normalize(owner.vel), this.lungeSpeed);
    weapon.angle = angleOf(owner.vel);
    if (this.timer <= 0) this.finish();
  }

  onHit(target, sim) {
    if (this.phase !== 'lunge') return;
    this.owner.vel = scale(this.owner.vel, this.recoil);
    this.finish();
  }

  onParry() {
    if (this.phase === 'lunge') this.finish();
  }

  finish() {
    this.phase = null;
    this.target = null;
  }

  drawUnder(ctx) {
    if (this.phase === 'aim') this.drawAim(ctx);
    else if (this.phase === 'lunge') this.drawLunge(ctx);
  }

  // A ring tightening around the ball while it lines up the stab.
  drawAim(ctx) {
    const { owner } = this;
    const progress = 1 - this.timer / this.aimTime;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.25 + 0.6 * progress;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 4 + 14 * (1 - progress), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Afterimages behind the lunge.
  drawLunge(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 4; i++) {
      const behind = scale(owner.vel, -0.018 * i);
      ctx.globalAlpha = 0.3 * (1 - i / 5);
      ctx.beginPath();
      ctx.arc(owner.pos.x + behind.x, owner.pos.y + behind.y, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Dual Wielder ---------------------------------------------------------------

export class DualWielder extends SwordTransformation {
  static id = 'dual-wielder';
  static displayName = 'Dual Wielder';
  static description =
    'Swap your shield for a short second sword. It still blocks, deals 3 damage to enemies it touches (+0.5 each time your sword hits), and gets your shield upgrades.';

  constructor(weapon) {
    super(weapon);
    this.damagePerHit = 0.5; // off-hand damage gained whenever the main sword lands a hit
  }

  apply() {
    this.weapon.shields = this.weapon.shields.map((shield) => new OffhandSword(this.weapon, { offset: shield.offset }));
  }

  onHit() {
    for (const shield of this.weapon.shields) {
      if (shield instanceof OffhandSword) shield.contactDamage += this.damagePerHit;
    }
  }
}

// ---- Gladiator ------------------------------------------------------------------

const NET_COLOR = '#d8c690';

export class Gladiator extends SwordTransformation {
  static id = 'gladiator';
  static displayName = 'Gladiator';
  static description = "Every 4 s, throw a net at the enemy. If it lands they're 50% slower and take 50% more damage for 2.5 s.";

  constructor(weapon) {
    super(weapon);
    this.interval = 4; // s between throws
    this.throwSpeed = 520; // px/s
    this.range = 400; // px it flies before dropping
    this.triggerRange = 340; // px; only throws when an enemy is this close
    this.netRadius = 14; // px hit radius of the flying net
    this.netDuration = 2.5; // s
    this.slow = 0.5; // speed multiplier while netted
    this.vulnerability = 1.5; // damage taken multiplier while netted
    this.cooldownLeft = this.interval / 2;

    this.net = null; // { pos, vel, travelled, spin } while one is flying
  }

  onUpdate(dt, sim) {
    const { net } = this;
    if (!net) {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0 && !sim.over) this.tryThrow(sim);
      return;
    }

    net.pos = add(net.pos, scale(net.vel, dt));
    net.travelled += this.throwSpeed * dt;
    net.spin += 6 * dt;
    const target = sim.over ? null : touchedEnemy(sim, this.owner, net.pos, this.netRadius);
    if (target) {
      const { netDuration: duration, slow, vulnerability } = this;
      target.addStatus(new Netted({ source: this.owner, duration, slow, vulnerability }), sim);
      this.emit(sim, 'net', { pos: target.pos, text: 'NETTED', color: NET_COLOR, burst: { color: NET_COLOR, count: 12, speed: 160, life: 0.4 } });
      this.net = null;
    } else if (net.travelled >= this.range || outsideArena(net.pos, sim.arena)) {
      this.net = null;
    }
  }

  tryThrow(sim) {
    const enemy = this.nearestEnemy(sim);
    if (!enemy || distance(enemy.pos, this.owner.pos) > this.triggerRange) return;
    const dir = leadDirection(this.owner.pos, enemy, this.throwSpeed);
    this.net = {
      pos: add(this.owner.pos, scale(dir, this.owner.radius)),
      vel: scale(dir, this.throwSpeed),
      travelled: 0,
      spin: 0,
    };
    this.cooldownLeft = this.interval;
    this.emit(sim, 'net-throw');
  }

  // The flying net opens up as it goes.
  drawOver(ctx) {
    if (!this.net) return;
    const { pos, spin, travelled } = this.net;
    const r = this.netRadius * (0.6 + 0.6 * Math.min(1, travelled / 150));
    drawNet(ctx, pos, r, spin, 1);
  }
}

export class Netted extends Status {
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

  // Slow down right away rather than easing into it.
  onApply() {
    const { ball } = this;
    if (!ball.weapon.controlsMovement) ball.vel = scale(ball.vel, this.slow);
  }

  // Drapes over the ball, fading out at the end.
  draw(ctx) {
    const alpha = Math.min(1, this.timeLeft / 0.3);
    drawNet(ctx, this.ball.pos, this.ball.radius + 4, 0.4, alpha);
  }
}

// A round net: a rim and a diamond mesh clipped to it.
function drawNet(ctx, pos, r, spin, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.translate(pos.x, pos.y);
  ctx.rotate(spin);
  ctx.strokeStyle = NET_COLOR;

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.clip();

  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const gap = Math.max(6, r / 3);
  for (let d = -r * 2; d <= r * 2; d += gap) {
    ctx.moveTo(d - r, -r);
    ctx.lineTo(d + r, r);
    ctx.moveTo(d - r, r);
    ctx.lineTo(d + r, -r);
  }
  ctx.stroke();
  ctx.restore();
}

// ---- Helpers --------------------------------------------------------------------

// Direction to throw something from `from` at `speed` so it meets `target`,
// assuming the target keeps going straight.
function leadDirection(from, target, speed) {
  const time = distance(from, target.pos) / speed;
  return normalize(sub(add(target.pos, scale(target.vel, time)), from));
}

// The first enemy ball (not `owner`) within `radius` px of touching `pos`, or null.
function touchedEnemy(sim, owner, pos, radius) {
  return sim.aliveBalls.find((ball) => ball !== owner && distance(ball.pos, pos) < ball.radius + radius) ?? null;
}

function outsideArena({ x, y }, arena) {
  return x < 0 || y < 0 || x > arena.width || y > arena.height;
}
