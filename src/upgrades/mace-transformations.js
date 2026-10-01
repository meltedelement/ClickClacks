import { Upgrade } from './Upgrade.js';
import { Burning } from './sword-transformations.js';
import { DropSlam } from '../abilities/DropSlam.js';
import { Status } from '../sim/Status.js';
import { TAU, add, clamp, distance, fromAngle, normalize, scale, sub } from '../sim/math.js';

// Transformations for the Mace: big upgrades that change how it fights, nearly
// all built around Drop Slam. Like the other weapons', they combine with each
// other and with the small upgrades, and are applied before the small ones.

class MaceTransformation extends Upgrade {
  static weapons = ['mace'];
  static maxStacks = 1;
  static transformation = true;
}

const HEAD_RADIUS = 10; // matches Mace.js, for drawing on the head

// True while Drop Slam is falling (or rising, with Pilot): the part that hits hard.
function slamming(ability) {
  return ability instanceof DropSlam && ability.phase === 'drop';
}

// ---- Portaler -------------------------------------------------------------------

const PORTAL_IN = '#4fb3ff';
const PORTAL_OUT = '#ff9f2e';
const PORTAL_CLOSE_TIME = 0.3; // s the exit portal takes to close behind the ball

export class Portaler extends MaceTransformation {
  static id = 'portaler';
  static displayName = 'Portaler';
  static description =
    'The first time Drop Slam reaches the floor, it goes through a portal and comes out of the ceiling at full speed for a second fall. It lands the second time. Drop Slam\'s cooldown is 60% longer.';

  constructor(weapon) {
    super(weapon);
    this.cooldownPenalty = 0.6; // Drop Slam's cooldown is this much longer, since every slam falls twice
    this.time = 0; // for the swirl
    this.wrapsLeft = 0; // the slam's, last step, to notice it going through
    this.exit = null; // { x, y, timeLeft } while the exit portal closes
  }

  apply() {
    const { ability } = this;
    if (!(ability instanceof DropSlam)) return;
    ability.wraps += 1;
    ability.cooldown *= 1 + this.cooldownPenalty;
    ability.cooldownLeft *= 1 + this.cooldownPenalty;
  }

  onUpdate(dt) {
    this.time += dt;
    if (this.exit) {
      this.exit.timeLeft -= dt;
      if (this.exit.timeLeft <= 0) this.exit = null;
    }
    const { ability, owner } = this;
    if (!(ability instanceof DropSlam)) return;
    if (ability.active && ability.wrapsLeft < this.wrapsLeft) {
      this.exit = { x: owner.pos.x, y: ability.dir > 0 ? 0 : owner.arena.height, timeLeft: PORTAL_CLOSE_TIME };
    }
    this.wrapsLeft = ability.active ? ability.wrapsLeft : 0;
  }

  // While a slam can still go through: a blue portal ahead of the ball and an
  // orange one on the opposite wall, both following it across.
  drawUnder(ctx) {
    const { ability, owner } = this;
    if (this.exit) drawPortal(ctx, this.exit.x, this.exit.y, owner.radius, PORTAL_OUT, this.time, this.exit.timeLeft / PORTAL_CLOSE_TIME);
    if (!(ability instanceof DropSlam) || !ability.active || ability.wrapsLeft <= 0) return;
    const { height } = owner.arena;
    const opening = ability.phase === 'hover' ? 1 - ability.timer / ability.hoverTime : 1;
    const entry = ability.dir > 0 ? height : 0;
    drawPortal(ctx, owner.pos.x, entry, owner.radius, PORTAL_IN, this.time, opening);
    drawPortal(ctx, owner.pos.x, height - entry, owner.radius, PORTAL_OUT, this.time, opening);
  }

  // A blue and an orange ring on the handle.
  drawBlade(ctx, start) {
    ctx.save();
    ctx.fillStyle = PORTAL_IN;
    ctx.fillRect(start + 12, -4, 4, 8);
    ctx.fillStyle = PORTAL_OUT;
    ctx.fillRect(start + 20, -4, 4, 8);
    ctx.restore();
  }
}

// A flat glowing oval lying on the floor or ceiling at (x, y), `size` 0–1 open.
function drawPortal(ctx, x, y, radius, color, time, size) {
  if (size <= 0) return;
  const rx = (radius + 14) * size;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, 18 * size, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 6]);
  ctx.lineDashOffset = -time * 60;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, 18 * size, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ---- Valkyrie -------------------------------------------------------------------

const WING_OPEN_RATE = 12; // how quickly the wings spread and fold (per second)

export class Valkyrie extends MaceTransformation {
  static id = 'valkyrie';
  static displayName = 'Valkyrie';
  static description =
    'While Drop Slam falls you spread a wing on each side, and each one swings a mace: twice the maces for the whole fall. The wings also steer three times as well, towards whichever mace is closer.';

  constructor(weapon) {
    super(weapon);
    this.steerBonus = 2; // +200% Drop Slam steering
    this.switchDistance = 20; // px the enemy must be past your centre before steering for the other mace
    this.added = 0; // blades added for the current fall, taken off again when it ends
    this.open = 0; // 0 folded .. 1 spread, for drawing
  }

  apply() {
    if (this.ability instanceof DropSlam) this.ability.steerSpeed *= 1 + this.steerBonus;
  }

  onUpdate(dt) {
    const { ability } = this;
    const falling = slamming(ability);
    if (falling && !this.added) {
      this.added = this.weapon.blades;
      this.weapon.blades += this.added;
    } else if (!falling && this.added) {
      this.fold();
    }
    // With a mace on both sides, bring down whichever is on the enemy's side.
    if (falling && ability.target?.alive) {
      const dx = ability.target.pos.x - this.owner.pos.x;
      if (Math.abs(dx) > this.switchDistance) ability.side = Math.sign(dx);
    }
    this.open += ((falling ? 1 : 0) - this.open) * Math.min(1, WING_OPEN_RATE * dt);
  }

  onAbilityEnd() {
    this.fold();
  }

  fold() {
    this.weapon.blades -= this.added;
    this.added = 0;
  }

  drawUnder(ctx) {
    const { owner } = this;
    for (const side of [-1, 1]) drawWing(ctx, owner.pos, side, owner.radius, this.open);
  }
}

// A white feathered wing on one side of the ball, pointing up when folded and
// out to the side when spread.
function drawWing(ctx, pos, side, radius, open) {
  const len = radius * (0.8 + 0.9 * open);
  const feathers = 5;
  ctx.save();
  ctx.translate(pos.x + side * radius * 0.55, pos.y - radius * 0.35);
  ctx.scale(side, 1);
  ctx.rotate(-1.25 + 0.95 * open);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1.5;
  for (let i = feathers - 1; i >= 0; i--) {
    const f = i / (feathers - 1);
    const featherLen = len * (1 - 0.35 * f);
    ctx.save();
    ctx.rotate(f * 0.75);
    ctx.fillStyle = i % 2 ? '#e3e8ef' : '#ffffff';
    ctx.beginPath();
    ctx.ellipse(featherLen / 2, 0, featherLen / 2, 7, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ---- Metalworker ----------------------------------------------------------------

const HOT = '#ff7a1a';

export class Metalworker extends MaceTransformation {
  static id = 'metalworker';
  static displayName = 'Metalworker';
  static description =
    'Every 0.5 s you go without dealing damage, taking damage or parrying, you hammer your mace: +0.5 damage on your next hit (up to +4).';

  constructor(weapon) {
    super(weapon);
    this.interval = 0.5; // s of quiet per clang
    this.damagePerClang = 0.5;
    this.maxClangs = 8;
    this.clangs = 0; // bonus built up for the next hit
    this.timer = 0;
    this.lastHp = null;
  }

  // The mace becomes a smith's hammer.
  apply() {
    this.weapon.head = 'hammer';
  }

  // Adds the bonus to the mace's own damage, before the slam multiplies it.
  get bonusDamage() {
    return this.clangs * this.damagePerClang;
  }

  onUpdate(dt, sim) {
    const { hp } = this.owner;
    if (this.lastHp !== null && hp < this.lastHp) this.timer = 0;
    this.lastHp = hp;
    if (sim.over || this.clangs >= this.maxClangs) return;

    this.timer += dt;
    if (this.timer < this.interval) return;
    this.timer -= this.interval;
    this.clangs += 1;
    this.emit(sim, 'clang', { pos: headPos(this.weapon), burst: { color: '#ffd23f', count: 5, speed: 170, life: 0.25, size: 2 } });
  }

  onHit() {
    this.clangs = 0;
    this.timer = 0;
  }

  onParry() {
    this.timer = 0;
  }

  // The hammer's head glows hotter the bigger the bonus.
  drawBlade(ctx, start) {
    if (this.clangs === 0) return;
    const heat = this.clangs / this.maxClangs;
    const x = start + this.weapon.length - HEAD_RADIUS;
    const glow = 4 + 6 * heat;
    ctx.save();
    ctx.fillStyle = HOT;
    ctx.globalAlpha = 0.2 + 0.25 * heat;
    ctx.beginPath();
    ctx.roundRect(x - 9 - glow, -18 - glow, 18 + glow * 2, 36 + glow * 2, glow);
    ctx.fill();
    ctx.globalAlpha = 0.3 + 0.55 * heat;
    ctx.fillRect(x - 9, -18, 18, 36);
    ctx.restore();
  }
}

// Centre of the first blade's head, in arena coordinates.
function headPos(weapon) {
  const { owner } = weapon;
  return add(owner.pos, fromAngle(weapon.bladeAngles()[0], owner.radius + weapon.gap + weapon.length - HEAD_RADIUS));
}

// ---- Pilot ----------------------------------------------------------------------

export class Pilot extends MaceTransformation {
  static id = 'pilot';
  static displayName = 'Pilot';
  static description = 'Drop Slam can also go up: from low down, rocket up to the ceiling instead, gaining damage with height the same way.';

  constructor(weapon) {
    super(weapon);
    this.time = 0; // for the flame flicker
  }

  apply() {
    if (this.ability instanceof DropSlam) this.ability.canRise = true;
  }

  onUpdate(dt) {
    this.time += dt;
  }

  // Rocket exhaust under the ball while it rises, and a small flicker while it gets ready.
  drawUnder(ctx) {
    const { ability, owner } = this;
    if (!(ability instanceof DropSlam) || !ability.active || ability.dir > 0) return;
    const rising = ability.phase === 'drop';
    const len = (rising ? 30 + ability.fallSpeed * 0.02 : 14) * (1 + 0.15 * Math.sin(this.time * 40));
    const { x } = owner.pos;
    const y = owner.pos.y + owner.radius - 6;
    ctx.save();
    for (const [color, width, share] of [['#ff7a1a', 18, 1], ['#ffd23f', 10, 0.6]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - width, y);
      ctx.quadraticCurveTo(x - width * 0.3, y + len * share * 0.6, x, y + len * share);
      ctx.quadraticCurveTo(x + width * 0.3, y + len * share * 0.6, x + width, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Flying goggles on top of the ball.
  drawOver(ctx) {
    const { x, y: cy } = this.owner.pos;
    const r = this.owner.radius;
    const y = cy - r * 0.55;
    ctx.save();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.83, y + 4);
    ctx.quadraticCurveTo(x, y - 6, x + r * 0.83, y + 4);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.fillStyle = '#9fe8ff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * 10, y - 1, 7, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Crusher --------------------------------------------------------------------

const STUN_COLOR = '#ffe066';

export class Crusher extends MaceTransformation {
  static id = 'crusher';
  static displayName = 'Crusher';
  static description = 'A Drop Slam hit stuns the enemy for 2.5 s: they deal 30% damage and move at 30% speed until it wears off.';
  // After Rubber Mace, so on the same hit the enemy is already Bouncing and the stun waits for it.
  static order = 1;

  constructor(weapon) {
    super(weapon);
    this.stunDuration = 2.5;
    this.stunSlow = 0.3;
    this.stunDamage = 0.3; // share of their damage a stunned enemy still deals
  }

  onHit(target, sim) {
    if (!slamming(this.ability) || !target.alive || sim.over) return;
    target.addStatus(new Stunned({ source: this.owner, duration: this.stunDuration, slow: this.stunSlow, damage: this.stunDamage, crusher: this }), sim);
  }

  // Heavy iron bands around the head.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - HEAD_RADIUS;
    ctx.save();
    ctx.strokeStyle = '#4a4f57';
    ctx.lineWidth = 3;
    for (const dx of [-4, 4]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, -HEAD_RADIUS + 1);
      ctx.lineTo(x + dx, HEAD_RADIUS - 1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// From Crusher: the ball deals much less damage for a while, and is dazed and slow.
// While Rubber Mace has it Bouncing, the stun waits (and doesn't tick down),
// then starts in full once the bouncing is over.
export class Stunned extends Status {
  constructor({ source, duration, slow, damage, crusher }) {
    super({ source, duration });
    this.slow = slow;
    this.damage = damage;
    this.crusher = crusher; // the Crusher upgrade, to show the stun when it starts
    this.started = false;
  }

  get waiting() {
    return this.ball.hasStatus(Bouncing);
  }

  get damageDealtMultiplier() {
    return this.started ? this.damage : 1;
  }

  get speedMultiplier() {
    return this.started ? this.slow : 1;
  }

  onApply(sim) {
    if (!this.waiting) this.start(sim);
  }

  update(dt, sim) {
    if (!this.started) {
      if (this.waiting) return;
      this.start(sim);
    }
    super.update(dt, sim);
  }

  // Dazed straight away, so the slam (or the last bounce) doesn't send them far.
  start(sim) {
    const { ball } = this;
    this.started = true;
    if (!ball.weapon.controlsMovement) ball.vel = scale(ball.vel, this.slow);
    if (sim.over) return;
    this.crusher.emit(sim, 'stun', { pos: ball.pos, text: 'STUNNED', color: STUN_COLOR, burst: { color: STUN_COLOR, count: 10, speed: 150, life: 0.4 } });
  }

  // Stars circling over the ball.
  draw(ctx) {
    if (!this.started) return;
    const { pos, radius } = this.ball;
    const stars = 3;
    ctx.save();
    ctx.fillStyle = STUN_COLOR;
    ctx.globalAlpha = Math.min(1, this.timeLeft / 0.2);
    for (let i = 0; i < stars; i++) {
      const a = this.age * 6 + (i * TAU) / stars;
      drawStar(ctx, { x: pos.x + Math.cos(a) * radius * 0.75, y: pos.y - radius - 6 + Math.sin(a) * radius * 0.25 }, 6);
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

// ---- Rubber Mace ----------------------------------------------------------------

const RUBBER = '#e0457b';

export class RubberMace extends MaceTransformation {
  static id = 'rubber-mace';
  static displayName = 'Rubber Mace';
  static description = 'A Drop Slam hit sends the enemy flying at huge speed for 1.2 s, taking 3 damage every time they hit a wall.';

  constructor(weapon) {
    super(weapon);
    this.launchSpeed = 1300; // px/s the enemy is held at
    this.duration = 1.2; // s
    this.wallDamage = 3;
  }

  onHit(target, sim) {
    if (!slamming(this.ability) || !target.alive || sim.over) return;
    target.vel = scale(normalize(target.vel), this.launchSpeed);
    const { launchSpeed: speed, duration, wallDamage: damage } = this;
    target.addStatus(new Bouncing({ source: this.owner, duration, speed, damage }), sim);
    this.emit(sim, 'launch', { pos: target.pos, shake: 4, text: 'BOING', color: RUBBER });
  }

  // A pink rubber coat on the head.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length - HEAD_RADIUS;
    ctx.save();
    ctx.fillStyle = RUBBER;
    ctx.beginPath();
    ctx.arc(x, 0, HEAD_RADIUS + 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(x - 3, -4, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// From Rubber Mace: the ball keeps flying at full speed, and walls hurt.
export class Bouncing extends Status {
  constructor({ source, duration, speed, damage }) {
    super({ source, duration });
    this.speed = speed;
    this.damage = damage;
    this.wallGap = 0.1; // s; a ball pinned against a wall only takes the damage this often
    this.sinceWall = Infinity;
  }

  onUpdate(dt) {
    this.sinceWall += dt;
    const { ball } = this;
    if (!ball.weapon.controlsMovement) ball.vel = scale(normalize(ball.vel), this.speed);
  }

  onWallBounce(sim) {
    if (sim.over || this.sinceWall < this.wallGap) return;
    this.sinceWall = 0;
    sim.dealDamage(this.source, this.ball, this.damage, { reason: 'wall', color: RUBBER });
  }

  // Speed lines streaming out behind the ball.
  draw(ctx) {
    const { pos, radius, vel } = this.ball;
    const back = scale(normalize(vel), -1);
    const across = { x: -back.y, y: back.x };
    ctx.save();
    ctx.strokeStyle = RUBBER;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.7 * Math.min(1, this.timeLeft / 0.3);
    for (const offset of [-0.6, 0, 0.6]) {
      const from = add(pos, add(scale(back, radius + 4), scale(across, offset * radius)));
      const to = add(from, scale(back, 22 - Math.abs(offset) * 10));
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Kamikaze -------------------------------------------------------------------

const BLAST = '#ff8a3d';
const BLAST_TIME = 0.35; // s the blast ring takes to spread

export class Kamikaze extends MaceTransformation {
  static id = 'kamikaze';
  static displayName = 'Kamikaze';
  static description =
    'When Drop Slam hits the floor you explode: enemies within 140 px take 40% of the damage the slam would have dealt, and are blown away.';

  constructor(weapon) {
    super(weapon);
    this.blastRadius = 140; // px from your centre to the edge of an enemy
    this.damageShare = 0.4; // of what a slam hit would do after that fall
    this.blastKnockback = 2; // enemies fly off at their speed x this
    this.time = 0; // for the fuse spark
    this.blast = null; // { pos, timeLeft } while the ring spreads
  }

  onUpdate(dt) {
    this.time += dt;
    if (this.blast) {
      this.blast.timeLeft -= dt;
      if (this.blast.timeLeft <= 0) this.blast = null;
    }
  }

  onAbilityEnd(ability, sim) {
    const landing = ability instanceof DropSlam ? ability.landing : null;
    if (!landing || sim.over) return;
    const { owner } = this;
    const damage = this.weapon.damage * (1 + landing.fallen * ability.damagePerPx) * this.damageShare;
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner || distance(enemy.pos, landing.pos) - enemy.radius > this.blastRadius) continue;
      enemy.vel = scale(normalize(sub(enemy.pos, landing.pos)), enemy.speed * this.blastKnockback);
      sim.dealDamage(owner, enemy, damage, { reason: 'explosion', color: BLAST });
    }
    this.blast = { pos: landing.pos, timeLeft: BLAST_TIME };
    this.emit(sim, 'explode', { pos: landing.pos, shake: 8, burst: { color: BLAST, count: 40, speed: 380, life: 0.5, size: 3.5 } });
  }

  drawOver(ctx) {
    if (!this.blast) return;
    const t = 1 - this.blast.timeLeft / BLAST_TIME;
    const { pos } = this.blast;
    const r = this.owner.radius + (this.blastRadius - this.owner.radius) * Math.sqrt(t);
    ctx.save();
    ctx.fillStyle = '#ffd23f';
    ctx.globalAlpha = 0.35 * (1 - t);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = BLAST;
    ctx.globalAlpha = 0.9 * (1 - t);
    ctx.lineWidth = 8 * (1 - t) + 2;
    ctx.stroke();
    ctx.restore();
  }

  // A lit fuse sticking out of the head.
  drawBlade(ctx, start) {
    const x = start + this.weapon.length;
    ctx.save();
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 2, 0);
    ctx.quadraticCurveTo(x + 6, -8, x + 12, -3);
    ctx.stroke();
    ctx.fillStyle = Math.sin(this.time * 30) > 0 ? '#ffd23f' : BLAST;
    ctx.beginPath();
    ctx.arc(x + 12, -3, 3 + Math.sin(this.time * 47), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---- Devil ----------------------------------------------------------------------

const HELLFIRE = '#ff4d1a';
const HELLFIRE_CORE = '#ffd23f';
const PILLAR_RISE_TIME = 0.15; // s the pillar takes to shoot up across the arena

export class Devil extends MaceTransformation {
  static id = 'devil';
  static displayName = 'Devil';
  static description =
    'When Drop Slam hits the floor, a pillar of fire erupts under your mace for 2.5 s. Enemies in it burn for 1 damage every 0.5 s, and keep burning for 2 s after they leave.';

  constructor(weapon) {
    super(weapon);
    this.pillarWidth = 44; // px
    this.pillarTime = 2.5; // s
    this.burnDamage = 1; // per tick
    this.burnTick = 0.5; // s
    this.burnDuration = 2; // s the burn lasts after leaving the pillar
    this.pillars = []; // { x, from (y it erupted from), timeLeft, age }
    this.time = 0; // for the flicker
  }

  onAbilityEnd(ability, sim) {
    const landing = ability instanceof DropSlam ? ability.landing : null;
    if (!landing || sim.over) return;
    const half = this.pillarWidth / 2;
    const from = landing.dir > 0 ? sim.arena.height : 0;
    for (const tip of landing.tips) {
      const x = clamp(tip.x - Math.sign(tip.x - landing.pos.x) * HEAD_RADIUS, half, sim.arena.width - half);
      this.pillars.push({ x, from, timeLeft: this.pillarTime, age: 0 });
    }
    this.emit(sim, 'pillar', { pos: { x: this.pillars.at(-1).x, y: landing.pos.y }, shake: 4, burst: { color: HELLFIRE, count: 20, speed: 260, life: 0.5 } });
  }

  onUpdate(dt, sim) {
    this.time += dt;
    for (const pillar of this.pillars) {
      pillar.timeLeft -= dt;
      pillar.age += dt;
    }
    this.pillars = this.pillars.filter((pillar) => pillar.timeLeft > 0);
    if (sim.over) return;
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner) continue;
      if (this.pillars.some((pillar) => Math.abs(enemy.pos.x - pillar.x) < this.pillarWidth / 2 + enemy.radius)) this.ignite(enemy, sim);
    }
  }

  // Sets the enemy burning, or tops their burn back up without restarting its tick.
  ignite(enemy, sim) {
    const { burnDamage: damage, burnTick: tick, burnDuration: duration } = this;
    const burning = enemy.statuses.find((status) => status instanceof Burning);
    if (burning) burning.ticksLeft = Math.max(burning.ticksLeft, Math.round(duration / tick));
    else enemy.addStatus(new Burning({ source: this.owner, duration, damage, tick }), sim);
  }

  drawUnder(ctx) {
    for (const pillar of this.pillars) this.drawPillar(ctx, pillar);
  }

  // A column of fire shooting across the arena from where it erupted, flames licking up its sides.
  drawPillar(ctx, { x, from, timeLeft, age }) {
    const { height } = this.owner.arena;
    const reach = height * Math.min(1, age / PILLAR_RISE_TIME);
    const top = from > 0 ? from - reach : 0;
    const w = this.pillarWidth;
    ctx.save();
    ctx.globalAlpha = Math.min(1, timeLeft / 0.4);
    const glow = ctx.createLinearGradient(x - w, 0, x + w, 0);
    glow.addColorStop(0, 'rgba(255, 77, 26, 0)');
    glow.addColorStop(0.3, 'rgba(255, 77, 26, 0.55)');
    glow.addColorStop(0.5, 'rgba(255, 210, 63, 0.8)');
    glow.addColorStop(0.7, 'rgba(255, 77, 26, 0.55)');
    glow.addColorStop(1, 'rgba(255, 77, 26, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - w, top, w * 2, reach);

    for (let y = top + 10, i = 0; y < top + reach; y += 22, i++) {
      const lick = 8 + 6 * Math.sin(this.time * 18 + i * 1.9);
      for (const side of [-1, 1]) {
        ctx.fillStyle = HELLFIRE;
        flame(ctx, x + (side * w) / 2, y, side * lick, 6);
        ctx.fillStyle = HELLFIRE_CORE;
        flame(ctx, x + (side * w) / 2, y, side * lick * 0.5, 3);
      }
    }
    ctx.restore();
  }

  // Red horns on top of the ball.
  drawOver(ctx) {
    const { pos, radius } = this.owner;
    ctx.save();
    ctx.fillStyle = '#c4161c';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      const base = add(pos, fromAngle(-Math.PI / 2 + side * 0.55, radius - 2));
      const along = fromAngle(-Math.PI / 2 + side * 0.55, 1);
      const across = { x: -along.y, y: along.x };
      ctx.beginPath();
      ctx.moveTo(base.x + across.x * 8, base.y + across.y * 8);
      ctx.quadraticCurveTo(base.x + along.x * 14 + across.x * 4, base.y + along.y * 14 + across.y * 4, base.x + along.x * 18 - side * 6, base.y + along.y * 18 - 4);
      ctx.lineTo(base.x - across.x * 8, base.y - across.y * 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// One flame tongue pointing sideways: base centred on (x, y), tip `w` px away along x.
function flame(ctx, x, y, w, halfHeight) {
  ctx.beginPath();
  ctx.moveTo(x, y - halfHeight);
  ctx.quadraticCurveTo(x + w * 0.6, y - halfHeight * 0.4, x + w, y + halfHeight * 0.3);
  ctx.quadraticCurveTo(x + w * 0.5, y + halfHeight * 0.6, x, y + halfHeight);
  ctx.closePath();
  ctx.fill();
}
