import { Upgrade } from './Upgrade.js';
import { Sawblade } from '../abilities/Sawblade.js';
import { CutlassWave } from '../abilities/CutlassWave.js';
import { TAU, add, angleOf, distance, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';
import { reflectDamage, reflectedBy } from '../sim/reflect.js';
import { jitter } from '../sim/timing.js';
import { formatNumber } from '../utils/format.js';

// Transformations for the Daggers: big upgrades that change how they fight.
// Like the other weapons', they combine with each other and with the small
// upgrades, and are applied before the small ones.

class DaggersTransformation extends Upgrade {
  static weapons = ['daggers'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Rogue ----------------------------------------------------------------------

const SHADOW = '#8a5cff';
const GHOST_TIME = 0.4; // s the afterimage left behind by a teleport takes to fade

export class Rogue extends DaggersTransformation {
  static id = 'rogue';
  static displayName = 'Rogue';
  static description = 'Every 6th hit you land readies a vanish. The next hit on you misses and you teleport away.';

  constructor(weapon) {
    super(weapon);
    this.hitsNeeded = 6;
    this.candidates = 8; // random spots tried for the teleport; the one furthest from the attacker wins
    this.hits = 0; // towards the next vanish
    this.ready = false;
    this.ghost = null; // { pos, timeLeft } where it vanished from
    this.time = 0; // for the swirl
  }

  onUpdate(dt) {
    this.time += dt;
    if (this.ghost) {
      this.ghost.timeLeft -= dt;
      if (this.ghost.timeLeft <= 0) this.ghost = null;
    }
  }

  onHit(target, sim) {
    if (this.ready) return;
    this.hits += 1;
    if (this.hits < this.hitsNeeded) return;
    this.hits = 0;
    this.ready = true;
    this.emit(sim, 'shadow', { burst: { color: SHADOW, count: 8, speed: 110, life: 0.35 } });
  }

  preventHit(attackerWeapon, sim) {
    if (!this.ready) return false;
    this.ready = false;
    const { owner } = this;
    const from = { ...owner.pos };
    const enemy = attackerWeapon.owner;
    const to = this.escapeFrom(enemy, sim.arena);
    owner.pos.x = to.x;
    owner.pos.y = to.y;
    owner.vel = scale(normalize(sub(to, enemy.pos)), owner.speed);
    this.ghost = { pos: from, timeLeft: GHOST_TIME };
    this.emit(sim, 'vanish', { pos: from, burst: { color: SHADOW, count: 16, speed: 200, life: 0.4 } });
    this.emit(sim, 'teleport', { shake: 2, text: 'VANISH', color: SHADOW, burst: { color: SHADOW, count: 12, speed: 150, life: 0.35 } });
    return true;
  }

  // A random spot in the arena, as far from `enemy` as the tries allow.
  escapeFrom(enemy, arena) {
    const r = this.owner.radius;
    let best = null;
    let bestDistance = -1;
    for (let i = 0; i < this.candidates; i++) {
      const spot = vec(r + Math.random() * (arena.width - 2 * r), r + Math.random() * (arena.height - 2 * r));
      const d = distance(spot, enemy.pos);
      if (d > bestDistance) {
        best = spot;
        bestDistance = d;
      }
    }
    return best;
  }

  drawUnder(ctx) {
    if (!this.ghost) return;
    const { pos, timeLeft } = this.ghost;
    ctx.save();
    ctx.fillStyle = SHADOW;
    ctx.globalAlpha = 0.45 * (timeLeft / GHOST_TIME);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, this.owner.radius * (1.3 - 0.3 * (timeLeft / GHOST_TIME)), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // A hood, its rim studded with the hits towards the vanish. Once it's
  // ready, every stud and two eyes in the hood's shadow glow, and shadow swirls round.
  drawOver(ctx) {
    const { owner } = this;
    drawCowl(ctx, owner, this.ready ? this.hitsNeeded : this.hits, this.hitsNeeded, this.ready, this.time);
    if (!this.ready) return;
    const { x, y } = owner.pos;
    ctx.save();
    ctx.strokeStyle = SHADOW;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 3; i++) {
      const a = this.time * 4 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(x, y, owner.radius + 7, a, a + 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const COWL = '#2d2740';
const COWL_EDGE = '#16121f';

// A pointed hood over the top of the ball, open at the front so the number shows.
function drawCowl(ctx, { pos, radius: r }, lit, count, ready, time) {
  const { x, y } = pos;
  const hole = { x, y: y + r * 0.14, rx: r * 0.78, ry: r * 0.76 };
  const bottom = y + r * 0.42;
  ctx.save();

  // Hood: up over the top from one side to the other, its sides tapering in
  // to the face opening, then back along the top of the opening
  const side = 0.35; // angle on the opening where the sides meet it
  const meet = { x: hole.rx * Math.cos(side), y: hole.y + hole.ry * Math.sin(side) };
  const hood = new Path2D();
  hood.moveTo(x - r - 3, bottom);
  hood.bezierCurveTo(x - r - 7, y - r * 0.6, x - r * 0.5, y - r - 4, x + r * 0.05, y - r - 13);
  hood.bezierCurveTo(x + r * 0.6, y - r - 4, x + r + 7, y - r * 0.55, x + r + 3, bottom);
  hood.quadraticCurveTo(x + r * 0.9, bottom + r * 0.12, x + meet.x, meet.y);
  hood.ellipse(hole.x, hole.y, hole.rx, hole.ry, 0, side, Math.PI - side, true);
  hood.quadraticCurveTo(x - r * 0.9, bottom + r * 0.12, x - r - 3, bottom);
  hood.closePath();
  ctx.fillStyle = COWL;
  ctx.fill(hood);
  ctx.save();

  // Shadow inside the top of the opening, and the eyes in it when the vanish is ready
  ctx.beginPath();
  ctx.ellipse(hole.x, hole.y, hole.rx, hole.ry, 0, 0, TAU);
  ctx.clip();
  const shade = ctx.createLinearGradient(0, hole.y - hole.ry, 0, y - r * 0.2);
  shade.addColorStop(0, 'rgba(10, 6, 20, 0.75)');
  shade.addColorStop(1, 'rgba(10, 6, 20, 0)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, hole.y - hole.ry, r * 2, hole.ry);
  ctx.restore();

  ctx.strokeStyle = COWL_EDGE;
  ctx.lineWidth = 2;
  ctx.stroke(hood);
  ctx.strokeStyle = '#4a4060';
  ctx.beginPath();
  ctx.ellipse(hole.x, hole.y, hole.rx, hole.ry, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.stroke();

  if (ready) {
    const blink = Math.sin(time * 3) > 0.96 ? 0.2 : 1;
    ctx.fillStyle = '#d9c8ff';
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 8;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + dir * r * 0.26, y - r * 0.42, r * 0.11, r * 0.045 * blink + 0.5, dir * 0.15, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // Studs round the rim, one per hit towards the vanish
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (1.18 + (0.64 * i) / (count - 1));
    const sx = hole.x + Math.cos(a) * (hole.rx + 4);
    const sy = hole.y + Math.sin(a) * (hole.ry + 4);
    const on = i < lit;
    ctx.fillStyle = on ? SHADOW : '#151020';
    if (on) {
      ctx.shadowColor = SHADOW;
      ctx.shadowBlur = ready ? 8 : 4;
    }
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (on) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(sx - 0.8, sy - 0.8, 0.9, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---- Thief ----------------------------------------------------------------------

const GOLD = '#ffd23f';

export class Thief extends DaggersTransformation {
  static id = 'thief';
  static displayName = 'Thief';
  static description = 'Bumping into an enemy steals 20% of their next hit on you (up to 60%). Your next hit adds what you stole.';

  constructor(weapon) {
    super(weapon);
    this.stealShare = 0.2; // of their next hit, per bump
    this.maxSteals = 3;
    this.bumpCooldown = 0.5; // s; balls pressed together only count as a new bump this often
    this.steals = 0; // bumps waiting on their next hit
    this.stolen = 0; // damage waiting to be added to your next hit
    this.cooldownLeft = 0;
  }

  // Their next hit on you is weakened by what you've stolen from it.
  get damageTakenMultiplier() {
    return 1 - this.stealShare * this.steals;
  }

  // Adds the loot to the daggers' own damage, before other multipliers.
  get bonusDamage() {
    return this.stolen;
  }

  onUpdate(dt) {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
  }

  onBump(other, sim) {
    if (sim.over || this.cooldownLeft > 0 || this.steals >= this.maxSteals) return;
    this.cooldownLeft = this.bumpCooldown;
    this.steals += 1;
    this.emit(sim, 'steal', { pos: other.pos, text: 'STEAL', color: GOLD, burst: { color: GOLD, count: 6, speed: 140, life: 0.3, size: 2 } });
  }

  // `damage` already had the steal taken off; work out how much that was.
  onOwnerHit(attackerWeapon, sim, damage) {
    if (this.steals === 0) return;
    const kept = this.damageTakenMultiplier;
    const loot = (damage * (1 - kept)) / kept;
    this.steals = 0;
    this.stolen += loot;
    this.emit(sim, 'loot', { text: `+${formatNumber(loot)}`, color: GOLD });
  }

  onHit() {
    this.stolen = 0;
  }

  // A loot sack slung behind the ball, with a gold coin in its mouth per steal waiting.
  drawUnder(ctx) {
    drawLootSack(ctx, this.owner, this.steals);
  }

  // A domino mask.
  drawOver(ctx) {
    drawDominoMask(ctx, this.owner);
  }

  // The blades' edges turn gold while they carry stolen damage.
  drawBlade(ctx, start) {
    if (this.stolen <= 0) return;
    const end = start + this.weapon.length;
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(start + 14, 3.5);
    ctx.lineTo(end - 8, 3);
    ctx.lineTo(end - 1, 0);
    ctx.stroke();
    ctx.restore();
  }
}

const MASK = '#1d1d24';
const SACK = '#a8774a';
const SACK_DARK = '#6e4a28';

// A black domino mask across the top of the ball, the ball showing through its eye holes.
function drawDominoMask(ctx, { pos, radius: r }) {
  const { x } = pos;
  const y = pos.y - r * 0.46; // eye line
  const w = r * 0.78; // half width
  ctx.save();
  const mask = new Path2D();
  mask.moveTo(x, y - r * 0.08);
  mask.bezierCurveTo(x - w * 0.35, y - r * 0.26, x - w * 0.9, y - r * 0.26, x - w, y - r * 0.08);
  mask.quadraticCurveTo(x - w * 1.05, y + r * 0.14, x - w * 0.6, y + r * 0.2);
  mask.quadraticCurveTo(x - w * 0.2, y + r * 0.22, x, y + r * 0.06);
  mask.quadraticCurveTo(x + w * 0.2, y + r * 0.22, x + w * 0.6, y + r * 0.2);
  mask.quadraticCurveTo(x + w * 1.05, y + r * 0.14, x + w, y - r * 0.08);
  mask.bezierCurveTo(x + w * 0.9, y - r * 0.26, x + w * 0.35, y - r * 0.26, x, y - r * 0.08);
  mask.closePath();
  for (const dir of [-1, 1]) mask.ellipse(x + dir * w * 0.5, y, r * 0.15, r * 0.09, dir * -0.15, 0, TAU);
  ctx.fillStyle = MASK;
  ctx.fill(mask, 'evenodd');
  // A soft shine along the top
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.8, y - r * 0.12);
  ctx.bezierCurveTo(x - w * 0.6, y - r * 0.22, x - w * 0.3, y - r * 0.2, x - w * 0.1, y - r * 0.1);
  ctx.stroke();
  ctx.restore();
}

// A burlap sack poking out behind the ball's upper left, tied at the neck.
function drawLootSack(ctx, { pos, radius: r }, coins) {
  ctx.save();
  ctx.translate(pos.x - r * 0.62, pos.y - r * 0.62);
  ctx.rotate(-0.55);
  const s = r / 40;
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SACK_DARK;
  ctx.lineWidth = 2;

  // Body
  ctx.fillStyle = SACK;
  ctx.beginPath();
  ctx.moveTo(-6, -14);
  ctx.bezierCurveTo(-26, -8, -26, 22, 0, 24);
  ctx.bezierCurveTo(26, 22, 26, -8, 6, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Coins in its mouth
  for (let i = 0; i < coins; i++) {
    const cx = (i - (coins - 1) / 2) * 7;
    const cy = -27 - (i === 1 ? 3 : 0);
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // Neck, flared above the tie
  ctx.strokeStyle = SACK_DARK;
  ctx.lineWidth = 2;
  ctx.fillStyle = SACK;
  ctx.beginPath();
  ctx.moveTo(-6, -14);
  ctx.lineTo(-11, -24);
  ctx.quadraticCurveTo(0, -20, 11, -24);
  ctx.lineTo(6, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Rope tie
  ctx.strokeStyle = '#e0c48a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7, -15);
  ctx.lineTo(7, -15);
  ctx.stroke();

  // Patch
  ctx.strokeStyle = SACK_DARK;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(-12, 6, 9, 8);
  ctx.restore();
}

// ---- Saw ------------------------------------------------------------------------

export class Saw extends DaggersTransformation {
  static id = 'saw';
  static displayName = 'Saw';
  static description = "Backstab becomes a saw that latches on and keeps cutting for up to 3s, until you're hit or parried.";

  apply() {
    this.weapon.ability = new Sawblade(this.weapon);
  }

  // Big raked teeth all along the back of each blade, leaning back from the tip.
  drawBlade(ctx, start) {
    const { weapon } = this;
    const from = start + 13;
    const to = start + weapon.length - 9;
    const pitch = 6;
    const n = Math.max(1, Math.floor((to - from) / pitch));
    const step = (to - from) / n;
    ctx.save();
    ctx.fillStyle = weapon.parryLocked ? '#e8493f' : '#e3e8ee';
    ctx.strokeStyle = '#5d6672';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(from, -3);
    for (let i = 0; i < n; i++) {
      const x = from + i * step;
      ctx.lineTo(x + step * 0.2, -9);
      ctx.lineTo(x + step, -3);
    }
    ctx.lineTo(from, -3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Trickster ------------------------------------------------------------------

const THROWN_SPIN = 22; // rad/s a thrown dagger turns while flying
const MAX_FLIGHT_TIME = 3; // s; safety net in case it somehow never makes it back

export class Trickster extends DaggersTransformation {
  static id = 'trickster';
  static displayName = 'Trickster';
  static description = 'Every 1.5s, throw your dagger at a nearby enemy like a boomerang. It hits on the way out and back for half damage, and can crit.';

  constructor(weapon) {
    super(weapon);
    this.interval = 1.5; // s between throws
    this.passDamage = 0.5; // damage multiplier of a pass: half a stab
    this.knockback = 0.5; // knockback multiplier of a pass: a glancing blow
    this.striking = false; // true while a pass's hit is being dealt
    this.throwSpeed = 600; // px/s
    this.returnSpeed = 650; // px/s
    this.range = 260; // px it flies out before turning back
    this.curveRate = 1.6; // rad/s the throw curves by on the way out
    this.returnTurnRate = 4; // rad/s it turns back towards you at first...
    this.returnTurnGain = 14; // ...growing by this much per second, so it always gets home
    this.triggerRange = 320; // px; only throws when an enemy is this close
    this.hitRadius = 8; // px around the flying dagger
    this.cooldownLeft = jitter(this.interval / 2);

    this.throws = 0;
    this.time = 0; // for the bells' jingle
    // While one is flying: { pos, heading, speed, phase: 'out' | 'back', travelled, time, backTime, curve, spin, hit: Set }
    this.flying = null;
  }

  onUpdate(dt, sim) {
    this.time += dt;
    if (!this.flying) {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0 && !sim.over) this.tryThrow(sim);
      return;
    }

    const f = this.flying;
    const { owner } = this;
    f.time += dt;
    f.spin += THROWN_SPIN * f.curve * dt;

    // A parrying ball sends it back: it flies straight at the thrower and hits them instead.
    if (!f.reflector && !sim.over) f.reflector = reflectedBy(sim, owner, f.pos);
    if (f.reflector) {
      f.heading = angleOf(sub(owner.pos, f.pos));
      f.speed = this.returnSpeed;
      if (distance(owner.pos, f.pos) <= owner.radius + this.hitRadius + f.speed * dt) {
        if (!sim.over) sim.dealDamage(f.reflector, owner, reflectDamage(f.reflector, this.weapon.getDamage() * this.passDamage), { reason: 'reflect', color: '#e3e8ee' });
        this.catch(sim);
        return;
      }
      f.pos = add(f.pos, fromAngle(f.heading, f.speed * dt));
      return;
    }

    if (f.phase === 'out') {
      f.heading += this.curveRate * f.curve * dt;
      f.travelled += this.throwSpeed * dt;
      if (f.travelled >= this.range || outsideArena(f.pos, sim.arena)) {
        f.phase = 'back';
        f.hit.clear();
      }
    } else {
      f.backTime += dt;
      const turn = (this.returnTurnRate + this.returnTurnGain * f.backTime) * dt;
      f.heading = turnTowards(f.heading, angleOf(sub(owner.pos, f.pos)), turn);
      f.speed = this.returnSpeed;
      if (distance(owner.pos, f.pos) <= owner.radius + f.speed * dt || f.time >= MAX_FLIGHT_TIME) {
        this.catch(sim);
        return;
      }
    }
    f.pos = add(f.pos, fromAngle(f.heading, f.speed * dt));

    if (sim.over) return;
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner || f.hit.has(enemy) || distance(enemy.pos, f.pos) >= enemy.radius + this.hitRadius) continue;
      f.hit.add(enemy);
      this.strike(enemy, f.pos, sim);
      if (sim.over) break;
    }
  }

  // A pass through `enemy` is a hit with the dagger: the Daggers' damage and
  // crits, and it grows them like any other hit.
  strike(enemy, pos, sim) {
    const away = sub(pos, enemy.pos);
    const side = away.x || away.y ? normalize(away) : fromAngle(this.flying.heading + Math.PI);
    enemy.clearHitCooldown(this.weapon);
    this.striking = true;
    sim.applyHit(this.owner, enemy, add(enemy.pos, scale(side, enemy.radius)));
    this.striking = false;
  }

  get damageMultiplier() {
    return this.striking ? this.passDamage : 1;
  }

  get knockbackMultiplier() {
    return this.striking ? this.knockback : 1;
  }

  // Throws blade 0; the next one round (if any) takes its place, so the throws
  // take turns between the daggers. Throws the only dagger too, leaving just
  // the money bag. Doesn't throw in the middle of the ability.
  tryThrow(sim) {
    const { owner, weapon } = this;
    const enemy = this.enemyWithin(sim, this.triggerRange);
    if (weapon.blades < 1 || weapon.ability?.active || !enemy) return;

    const angles = weapon.bladeAngles();
    const pos = add(owner.pos, fromAngle(angles[0], owner.radius + weapon.gap + weapon.length / 2));
    // Aim off to one side so the curve brings it through where they'll be.
    const curve = this.throws % 2 === 0 ? 1 : -1;
    const flightTime = distance(pos, enemy.pos) / this.throwSpeed;
    const heading = angleOf(leadDirection(pos, enemy, this.throwSpeed)) - (this.curveRate * curve * Math.min(flightTime, this.range / this.throwSpeed)) / 2;

    if (angles.length > 1) weapon.angle = angles[1];
    weapon.blades -= 1;
    this.throws += 1;
    this.cooldownLeft = jitter(this.interval);
    this.flying = { pos, heading, speed: this.throwSpeed, phase: 'out', travelled: 0, time: 0, backTime: 0, curve, spin: angles[0], hit: new Set() };
    this.emit(sim, 'throw');
  }

  catch(sim) {
    this.flying = null;
    this.weapon.blades += 1;
    this.emit(sim, 'catch');
  }

  // A jester's hat, and the flying dagger, drawn like it is in hand, spinning about its middle.
  drawOver(ctx) {
    drawJesterHat(ctx, this.owner, this.time);
    if (!this.flying) return;
    const { weapon } = this;
    const { pos, spin } = this.flying;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(spin);
    ctx.scale(1, weapon.widthScale);
    weapon.drawBladeAt(ctx, -weapon.length / 2);
    ctx.restore();
  }
}

const JESTER_PURPLE = '#7b3fb5';
const JESTER_YELLOW = '#f2c230';

// A three-pointed jester's hat: two floppy points drooping over the sides and
// one standing up, each with a bell on the end.
function drawJesterHat(ctx, { pos, radius }, time) {
  const { x, y } = pos;
  const r = radius;
  const band = y - r + 13; // bottom of the hat
  const top = y - r;
  const jingle = 2 * Math.sin(time * 9);
  const points = [
    { from: x - r * 0.72, to: x - r * 0.05, tip: { x: x - r - 16, y: top + 12 + jingle }, c1: { x: x - r * 0.75, y: top - 22 }, c2: { x: x - r * 0.4, y: top - 8 }, color: JESTER_PURPLE },
    { from: x + r * 0.05, to: x + r * 0.72, tip: { x: x + r + 16, y: top + 12 - jingle }, c1: { x: x + r * 0.4, y: top - 8 }, c2: { x: x + r * 0.75, y: top - 22 }, color: JESTER_PURPLE },
    { from: x - r * 0.35, to: x + r * 0.35, tip: { x: x + jingle, y: top - 30 }, c1: { x: x - 6, y: top - 10 }, c2: { x: x + 6, y: top - 10 }, color: JESTER_YELLOW },
  ];
  ctx.save();
  ctx.strokeStyle = '#2e1a45';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const { from, to, tip, c1, c2, color } of points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(from, band);
    ctx.quadraticCurveTo(c1.x, c1.y, tip.x, tip.y);
    ctx.quadraticCurveTo(c2.x, c2.y, to, band);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  for (const { tip } of points) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // Band round the brim, in diamonds
  const edge = Math.sqrt(r * r - (y - band) * (y - band));
  ctx.fillStyle = JESTER_PURPLE;
  ctx.beginPath();
  ctx.roundRect(x - edge - 2, band - 3, (edge + 2) * 2, 7, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = JESTER_YELLOW;
  for (let dx = -edge + 6; dx <= edge - 6; dx += 10) {
    ctx.beginPath();
    ctx.moveTo(x + dx, band - 2);
    ctx.lineTo(x + dx + 3, band + 0.5);
    ctx.lineTo(x + dx, band + 3);
    ctx.lineTo(x + dx - 3, band + 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---- Ambidextrous -------------------------------------------------------------

export class Ambidextrous extends DaggersTransformation {
  static id = 'ambidextrous';
  static displayName = 'Ambidextrous';
  static description = 'Gain a second dagger.';

  apply() {
    this.weapon.blades += 1;
  }

  // A white cartoon glove gripping each dagger in hand (not ones thrown or flying as a saw).
  drawOver(ctx) {
    const { owner, weapon } = this;
    if (weapon.disarmed) return;
    const grip = owner.radius + weapon.gap + 4;
    ctx.save();
    ctx.fillStyle = '#f7f7f2';
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1.5;
    for (const angle of weapon.bladeAngles()) {
      ctx.save();
      ctx.translate(owner.pos.x, owner.pos.y);
      ctx.rotate(angle);
      // Cuff
      ctx.beginPath();
      ctx.roundRect(grip - 13, -6, 6, 12, 2);
      ctx.fill();
      ctx.stroke();
      // Fist
      ctx.beginPath();
      ctx.ellipse(grip, 0, 7, 7.5, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // Knuckles
      ctx.beginPath();
      for (const y of [-2.5, 2.5]) {
        ctx.moveTo(grip + 2, y);
        ctx.lineTo(grip + 6.5, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}

// ---- Slippery -------------------------------------------------------------------

const SLICK = '#7fe0d4';

export class Slippery extends DaggersTransformation {
  static id = 'slippery';
  static displayName = 'Slippery';
  static description = '20% chance for a hit to slide right off you, sending you skidding away.';
  // Asked before Rogue, so a slip doesn't use up a ready vanish.
  static order = -1;

  constructor(weapon) {
    super(weapon);
    this.chance = 0.2;
    this.slide = 1.3; // you shoot off at your speed x this
  }

  preventHit(attackerWeapon, sim) {
    if (Math.random() >= this.chance) return false;
    const { owner } = this;
    if (!this.weapon.controlsMovement) owner.vel = scale(normalize(sub(owner.pos, attackerWeapon.owner.pos)), owner.speed * this.slide);
    this.emit(sim, 'slip', { text: 'SLIP', color: SLICK, burst: { color: SLICK, count: 8, speed: 150, life: 0.3, size: 2 } });
    return true;
  }

  onUpdate(dt) {
    this.time = (this.time ?? 0) + dt;
  }

  // A glossy wet coat: a slick rim, a big shine, and drips running off the bottom.
  drawOver(ctx) {
    const { pos, radius: r } = this.owner;
    const { x, y } = pos;
    const time = this.time ?? 0;
    ctx.save();

    // Sheen round the edge
    const sheen = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
    sheen.addColorStop(0, 'rgba(127, 224, 212, 0)');
    sheen.addColorStop(1, 'rgba(127, 224, 212, 0.45)');
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = SLICK;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Shine
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.74, Math.PI * 1.08, Math.PI * 1.38);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(x + Math.cos(Math.PI * 1.48) * r * 0.74, y + Math.sin(Math.PI * 1.48) * r * 0.74, r * 0.05, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, Math.PI * 0.12, Math.PI * 0.3);
    ctx.stroke();

    // Drips: each swells on the edge, then falls away and fades
    ctx.fillStyle = SLICK;
    for (const [angle, offset] of [[0.32, 0], [0.62, 0.45], [0.82, 0.75]]) {
      const phase = (time / 1.4 + offset) % 1;
      const a = Math.PI * angle;
      const ex = x + Math.cos(a) * r;
      const ey = y + Math.sin(a) * r;
      const grow = Math.min(1, phase / 0.6);
      const fall = Math.max(0, phase - 0.6) / 0.4;
      const size = r * (0.05 + 0.05 * grow);
      ctx.globalAlpha = 0.9 * (1 - fall);
      drawDrop(ctx, ex, ey - size * 0.6 + fall * fall * r * 0.5 + grow * size, size);
    }
    ctx.restore();
  }
}

// A teardrop hanging point up, its round bottom centred on (x, y).
function drawDrop(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y - size * 2.2);
  ctx.bezierCurveTo(x + size * 0.4, y - size, x + size, y - size * 0.5, x + size, y);
  ctx.arc(x, y, size, 0, Math.PI);
  ctx.bezierCurveTo(x - size, y - size * 0.5, x - size * 0.4, y - size, x, y - size * 2.2);
  ctx.fill();
}

// ---- Careful --------------------------------------------------------------------

const POISE = '#9fd3ff';

export class Careful extends DaggersTransformation {
  static id = 'careful';
  static displayName = 'Careful';
  static description = 'Each parry adds +1 damage to your next crit (up to +6).';

  constructor(weapon) {
    super(weapon);
    this.damagePerParry = 1;
    this.maxParries = 6;
    this.parries = 0; // since the last crit
  }

  // Added to a critical hit's damage, after the crit multiplier.
  get critBonusDamage() {
    return this.parries * this.damagePerParry;
  }

  onParry(otherWeapon, sim) {
    if (this.parries >= this.maxParries || sim.over) return;
    this.parries += 1;
    this.emit(sim, 'poise', { burst: { color: POISE, count: 4, speed: 90, life: 0.25, size: 2 } });
  }

  onHit() {
    if (this.weapon.lastHitCrit) this.parries = 0;
  }

  // Sai prongs curving forward off the guard, and a glow on the blades that
  // gets brighter the bigger the bonus.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.strokeStyle = '#c3cad3';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(start + 9, side * 3);
      ctx.quadraticCurveTo(start + 10, side * 13, start + 26, side * 11);
    }
    ctx.stroke();
    ctx.restore();

    if (this.parries === 0) return;
    const charge = this.parries / this.maxParries;
    ctx.save();
    ctx.strokeStyle = POISE;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.3 + 0.5 * charge;
    ctx.lineWidth = 3 + 5 * charge;
    ctx.beginPath();
    ctx.moveTo(start + 14, 0);
    ctx.lineTo(start + this.weapon.length - 3, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Swashbuckler ---------------------------------------------------------------

export class Swashbuckler extends DaggersTransformation {
  static id = 'swashbuckler';
  static displayName = 'Swashbuckler';
  static description = 'Your dagger becomes a longer cutlass, and Backstab becomes a slash that sends a wave at the enemy. The wave crits everyone it passes through. With Saw, the wave chases its target and saws them.';
  // After Saw, so it can turn the Sawblade into a sawing wave.
  static order = 1;

  apply() {
    this.weapon.style = 'cutlass';
    this.weapon.length = 66;
    this.weapon.thickness = 4;
    this.weapon.ability = new CutlassWave(this.weapon, { saw: this.ability instanceof Sawblade });
  }

  onUpdate(dt) {
    this.time = (this.time ?? 0) + dt;
  }

  drawOver(ctx) {
    drawBandana(ctx, this.owner, this.time ?? 0);
  }
}

const BANDANA = '#c8302c';
const BANDANA_DARK = '#7d1a17';

// A red polka-dot pirate bandana over the top of the ball, knotted at the
// side with its two tails flapping.
function drawBandana(ctx, { pos, radius: r }, time) {
  const { x, y } = pos;
  // The bottom edge, high enough to leave the eyes (and a Thief's mask) showing
  const left = y - r * 0.64;
  const right = y - r * 0.7;
  const dip = y - r * 0.5; // its curve's control point
  const knot = { x: x + r * 0.78, y: y - r * 0.64 };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = BANDANA_DARK;
  ctx.lineWidth = 1.5;

  // Tails
  const flap = Math.sin(time * 7);
  ctx.fillStyle = BANDANA;
  for (const [len, drop, phase] of [[r * 0.6, r * 0.05, 0], [r * 0.5, r * 0.45, 1.3]]) {
    const wave = Math.sin(time * 7 + phase) * r * 0.08;
    ctx.beginPath();
    ctx.moveTo(knot.x, knot.y - r * 0.06);
    ctx.quadraticCurveTo(knot.x + len * 0.5, knot.y + drop * 0.4 - r * 0.12 + wave, knot.x + len, knot.y + drop + wave);
    ctx.lineTo(knot.x + len - r * 0.08, knot.y + drop + r * 0.14 + wave);
    ctx.quadraticCurveTo(knot.x + len * 0.45, knot.y + drop * 0.5 + r * 0.06 + wave * 0.5, knot.x, knot.y + r * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Cap, clipped to the ball (a touch bigger, so it sits on it)
  const cap = new Path2D();
  cap.moveTo(x - r - 2, left);
  cap.quadraticCurveTo(x, dip, x + r + 2, right);
  cap.lineTo(x + r + 2, y - r - 4);
  cap.lineTo(x - r - 2, y - r - 4);
  cap.closePath();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, TAU);
  ctx.clip();
  ctx.fillStyle = BANDANA;
  ctx.fill(cap);
  ctx.clip(cap);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  for (const [dx, dy] of [[-0.5, -0.75], [-0.15, -0.88], [0.22, -0.72], [0.5, -0.86], [-0.28, -0.6], [0.05, -0.6], [-0.7, -0.62]]) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, r * 0.055, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, Math.PI + Math.asin(0.62), TAU - Math.asin(0.66));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.8, left);
  ctx.quadraticCurveTo(x, dip, x + r * 0.76, right);
  ctx.stroke();

  // Knot
  ctx.fillStyle = BANDANA;
  ctx.beginPath();
  ctx.ellipse(knot.x, knot.y, r * 0.12, r * 0.1 + flap * 0.3, 0.4, 0, TAU);
  ctx.fill();
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

function outsideArena({ x, y }, arena) {
  return x < 0 || y < 0 || x > arena.width || y > arena.height;
}
