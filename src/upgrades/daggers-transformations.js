import { Upgrade } from './Upgrade.js';
import { Buzzsaw } from '../abilities/Buzzsaw.js';
import { TAU, add, angleOf, distance, fromAngle, normalize, scale, sub, turnTowards, vec } from '../sim/math.js';
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
  static description = 'Every 6th hit you land readies a vanish: the next hit you would take misses completely as you teleport away from the attacker.';

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

  // Small pips over the ball counting hits towards the vanish, and a swirling
  // shadow around it once it's ready.
  drawOver(ctx) {
    const { owner } = this;
    const { x, y } = owner.pos;
    ctx.save();
    if (this.ready) {
      ctx.strokeStyle = SHADOW;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 3; i++) {
        const a = this.time * 4 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(x, y, owner.radius + 5, a, a + 1.2);
        ctx.stroke();
      }
    } else {
      const n = this.hitsNeeded;
      for (let i = 0; i < n; i++) {
        const px = x + (i - (n - 1) / 2) * 8;
        ctx.fillStyle = i < this.hits ? SHADOW : 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(px, y - owner.radius * 0.55, 2.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ---- Thief ----------------------------------------------------------------------

const GOLD = '#ffd23f';

export class Thief extends DaggersTransformation {
  static id = 'thief';
  static displayName = 'Thief';
  static description =
    "Whenever your ball bumps into an enemy, steal 20% of their next hit's damage (up to 60%). Your next hit deals what you stole on top.";

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

  // A bandit's mask, and gold coins above the ball, one per steal waiting.
  drawOver(ctx) {
    const { owner } = this;
    drawBanditMask(ctx, owner);
    ctx.save();
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < this.steals; i++) {
      const px = owner.pos.x + (i - (this.steals - 1) / 2) * 11;
      ctx.beginPath();
      ctx.arc(px, owner.pos.y - owner.radius - 8, 4.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // The blades glint gold while they carry stolen damage.
  drawBlade(ctx, start) {
    if (this.stolen <= 0) return;
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start + 14, 0);
    ctx.lineTo(start + this.weapon.length - 4, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// A black band across the ball with two eye holes, its ties trailing off the side.
function drawBanditMask(ctx, { pos, radius }) {
  const { x, y } = pos;
  const top = y - 27;
  const height = 14;
  ctx.save();
  ctx.fillStyle = '#1d1d22';

  // Ties
  const knot = { x: x + radius - 1, y: top + height / 2 };
  for (const [dx, dy] of [[16, -9], [18, 4]]) {
    ctx.beginPath();
    ctx.moveTo(knot.x, knot.y - 3);
    ctx.lineTo(knot.x + dx, knot.y + dy - 3);
    ctx.lineTo(knot.x + dx - 2, knot.y + dy + 3);
    ctx.lineTo(knot.x, knot.y + 3);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius + 1, 0, TAU);
  ctx.clip();
  ctx.fillRect(x - radius - 1, top, (radius + 1) * 2, height);
  ctx.restore();

  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x + dir * 13, top + height / 2, 6.5, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1d1d22';
    ctx.beginPath();
    ctx.arc(x + dir * 13 + 2, top + height / 2, 2.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Saw ------------------------------------------------------------------------

export class Saw extends DaggersTransformation {
  static id = 'saw';
  static displayName = 'Saw';
  static description =
    "Dash Flurry becomes Buzzsaw: launch your daggers as a spinning saw that chases the enemy for 2 s, landing a light hit (40% damage) every 0.1 s while it's on them. It grinds through weapons but not shields. Then it flies back. You're unarmed until it returns.";

  apply() {
    this.weapon.ability = new Buzzsaw(this.weapon);
  }

  // Teeth along the back of each blade.
  drawBlade(ctx, start) {
    const from = start + 14;
    const to = start + this.weapon.length - 8;
    ctx.save();
    ctx.fillStyle = '#b9c2cc';
    ctx.beginPath();
    for (let x = from; x + 5 <= to; x += 5) {
      ctx.moveTo(x, -3.5);
      ctx.lineTo(x + 2.5, -7);
      ctx.lineTo(x + 5, -3.5);
    }
    ctx.fill();
    ctx.restore();
  }
}

// ---- Trickster ------------------------------------------------------------------

const THROWN_SPIN = 22; // rad/s a thrown dagger turns while flying
const MAX_FLIGHT_TIME = 3; // s; safety net in case it somehow never makes it back

export class Trickster extends DaggersTransformation {
  static id = 'trickster';
  static displayName = 'Trickster';
  static description =
    'Every 1.5 s, when the enemy is close, throw one of your daggers like a boomerang. It curves out and back, dealing 3 damage to enemies it passes through each way. Throws alternate between your daggers, and you spin one short until it returns.';

  constructor(weapon) {
    super(weapon);
    this.interval = 1.5; // s between throws
    this.damage = 3; // per pass through an enemy
    this.throwSpeed = 600; // px/s
    this.returnSpeed = 650; // px/s
    this.range = 260; // px it flies out before turning back
    this.curveRate = 1.6; // rad/s the throw curves by on the way out
    this.returnTurnRate = 4; // rad/s it turns back towards you at first...
    this.returnTurnGain = 14; // ...growing by this much per second, so it always gets home
    this.triggerRange = 320; // px; only throws when an enemy is this close
    this.hitRadius = 8; // px around the flying dagger
    this.cooldownLeft = this.interval / 2;

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
      sim.dealDamage(owner, enemy, this.damage, { reason: 'boomerang', color: '#e3e8ee' });
    }
  }

  // Throws blade 0; the next one round takes its place, so the throws take
  // turns between the daggers. Keeps at least one in hand, and doesn't throw
  // in the middle of the ability.
  tryThrow(sim) {
    const { owner, weapon } = this;
    const enemy = this.nearestEnemy(sim);
    if (weapon.blades < 2 || weapon.ability?.active) return;
    if (!enemy || distance(enemy.pos, owner.pos) > this.triggerRange) return;

    const angles = weapon.bladeAngles();
    const pos = add(owner.pos, fromAngle(angles[0], owner.radius + weapon.gap + weapon.length / 2));
    // Aim off to one side so the curve brings it through where they'll be.
    const curve = this.throws % 2 === 0 ? 1 : -1;
    const flightTime = distance(pos, enemy.pos) / this.throwSpeed;
    const heading = angleOf(leadDirection(pos, enemy, this.throwSpeed)) - (this.curveRate * curve * Math.min(flightTime, this.range / this.throwSpeed)) / 2;

    weapon.angle = angles[1];
    weapon.blades -= 1;
    this.throws += 1;
    this.cooldownLeft = this.interval;
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
    weapon.drawLocal(ctx, -weapon.length / 2);
    for (const upgrade of weapon.upgrades) upgrade.drawBlade(ctx, -weapon.length / 2);
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

// ---- Multidexterous -------------------------------------------------------------

export class Multidexterous extends DaggersTransformation {
  static id = 'multidexterous';
  static displayName = 'Multidexterous';
  static description = 'Gain a third dagger.';

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
  static description = '20% chance for a hit on you to slide right off: no damage, and you squirt away from the attacker. Rolled separately from dodging.';
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

  // A wet shine on the ball.
  drawOver(ctx) {
    const { pos, radius } = this.owner;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(pos.x - radius * 0.35, pos.y - radius * 0.45, radius * 0.32, radius * 0.14, -0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = SLICK;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(pos.x + radius * 0.5, pos.y + radius * 0.62, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---- Careful --------------------------------------------------------------------

const POISE = '#9fd3ff';

export class Careful extends DaggersTransformation {
  static id = 'careful';
  static displayName = 'Careful';
  static description = 'Every parry adds +1 damage to your next hit (up to +6).';

  constructor(weapon) {
    super(weapon);
    this.damagePerParry = 1;
    this.maxParries = 6;
    this.parries = 0; // since the last hit
  }

  // Adds the bonus to the daggers' own damage, before other multipliers.
  get bonusDamage() {
    return this.parries * this.damagePerParry;
  }

  onParry(otherWeapon, sim) {
    if (this.parries >= this.maxParries || sim.over) return;
    this.parries += 1;
    this.emit(sim, 'poise', { burst: { color: POISE, count: 4, speed: 90, life: 0.25, size: 2 } });
  }

  onHit() {
    this.parries = 0;
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

// ---- Axeman ---------------------------------------------------------------------

export class Axeman extends DaggersTransformation {
  static id = 'axeman';
  static displayName = 'Axeman';
  static description = 'Swap your daggers for hatchets: twice as thick, so they hit and block much more, and they deal 25% more damage.';

  constructor(weapon) {
    super(weapon);
    this.damageBonus = 0.25;
  }

  get damageMultiplier() {
    return 1 + this.damageBonus;
  }

  apply() {
    this.weapon.style = 'hatchet';
    this.weapon.thickness *= 2;
  }
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
