import { Upgrade } from './Upgrade.js';
import { CONFIG } from '../config.js';
import { SpinSwipe } from '../abilities/SpinSwipe.js';
import { SpearThrow } from '../abilities/SpearThrow.js';
import { ChargeDash } from '../abilities/ChargeDash.js';
import { Shield } from '../weapons/Shield.js';
import { Status } from '../sim/Status.js';
import { Burning } from './sword-transformations.js';
import {
  TAU,
  add,
  angleOf,
  closestPointOnSegment,
  distance,
  fromAngle,
  normalize,
  scale,
  sub,
  turnTowards,
  vec,
} from '../sim/math.js';

// Transformations for the Spear: big upgrades that change how it fights. Like
// the Sword's, they combine with each other and with the small upgrades, and
// are applied before the small ones.

class SpearTransformation extends Upgrade {
  static weapons = ['spear'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Hoplite --------------------------------------------------------------------

const HOPLITE_OFFSET = -1.1; // radians: to the left of the spear

export class Hoplite extends SpearTransformation {
  static id = 'hoplite';
  static displayName = 'Hoplite';
  static description = 'Gain a shield like the Sword\'s, just to the left of your spear. It blocks enemy weapons.';

  constructor(weapon) {
    super(weapon);
    this.time = 0; // for the cape's ripple
  }

  apply() {
    const shield = new Shield(this.weapon, { offset: HOPLITE_OFFSET, width: 34 });
    shield.style = 'bronze';
    this.weapon.shields.push(shield);
  }

  onUpdate(dt) {
    this.time += dt;
  }

  // A red Spartan cape hanging behind the ball, swinging away from the way it moves.
  drawUnder(ctx) {
    const { pos, radius: r, vel } = this.owner;
    const { x, y } = pos;
    const sway = Math.max(-22, Math.min(22, -vel.x * 0.06));
    const hem = y + r + 20;
    const hemWidth = r + 12;
    ctx.save();
    ctx.fillStyle = '#b3202a';
    ctx.strokeStyle = '#6e1016';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.85, y - r * 0.35);
    ctx.quadraticCurveTo(x - r - 8, y + r * 0.4, x + sway - hemWidth, hem);
    const folds = 4;
    for (let i = 1; i <= folds; i++) {
      const fx = x + sway - hemWidth + (2 * hemWidth * i) / folds;
      const ripple = 6 * Math.sin(this.time * 7 + i * 1.3);
      ctx.quadraticCurveTo(fx - hemWidth / folds, hem + 8 + ripple, fx, hem);
    }
    ctx.quadraticCurveTo(x + r + 8, y + r * 0.4, x + r * 0.85, y - r * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Poseidon -------------------------------------------------------------------

const IMPALE_COLOR = '#5ec8e5';

export class Poseidon extends SpearTransformation {
  static id = 'poseidon';
  static displayName = 'Poseidon';
  static description =
    'Your spear becomes a trident with a big head. Hitting with the head skewers the enemy: they are carried on it for 0.7 s, then take a second hit at half damage and are flung off.';

  constructor(weapon) {
    super(weapon);
    this.headBonus = 14; // px longer head than a plain spear's, all of it counting as head hits
    this.holdTime = 0.7; // s the enemy stays skewered
    this.wallHoldTime = 0.2; // s after which touching a wall rips them off early
    this.releaseDamageMultiplier = 0.5;
    this.releaseKnockbackMultiplier = 1.4;
    this.depth = 0.6; // how far into the enemy the tip sinks, as a share of their radius
    this.cooldown = 2.5; // s after flinging someone off before the next skewer

    this.target = null; // the skewered ball
    this.bladeIndex = 0; // which blade they're on
    this.timer = 0;
    this.cooldownLeft = 0;
    this.releasing = false; // true during the release hit, so it doesn't skewer again
  }

  apply() {
    this.weapon.head = 'trident';
    this.weapon.headLength += this.headBonus;
  }

  // A sea god's golden crown, spiked, with sea-green gems.
  drawOver(ctx) {
    const { x, y } = this.owner.pos;
    const band = y - 28; // bottom of the band
    const half = 25;
    const spikes = 5;
    ctx.save();
    ctx.fillStyle = '#e8c04a';
    ctx.strokeStyle = '#8a6a14';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - half, band);
    ctx.lineTo(x - half, band - 8);
    for (let i = 0; i < spikes; i++) {
      const left = x - half + (2 * half * i) / spikes;
      const width = (2 * half) / spikes;
      const tall = i === 2 ? 24 : i % 2 ? 19 : 15;
      ctx.lineTo(left + width / 2, band - 8 - tall);
      ctx.lineTo(left + width, band - 8);
    }
    ctx.lineTo(x + half, band);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = IMPALE_COLOR;
    for (let i = 0; i < spikes; i++) {
      ctx.beginPath();
      ctx.arc(x - half + (2 * half * (i + 0.5)) / spikes, band - 4, i === 2 ? 3.5 : 2.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Their weapon would clash with the shaft they're stuck on; let everything pass through.
  get unblockable() {
    return this.target !== null;
  }

  get damageMultiplier() {
    return this.releasing ? this.releaseDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.releasing ? this.releaseKnockbackMultiplier : 1;
  }

  onHit(target, sim, damage, point) {
    if (this.releasing || this.target || this.cooldownLeft > 0 || sim.over || !target.alive) return;
    if (this.weapon.disarmed || !this.weapon.headHit(point)) return;
    this.target = target;
    this.bladeIndex = nearestBlade(this.weapon, angleOf(sub(point, this.owner.pos)));
    this.timer = this.holdTime;
    target.addStatus(new Impaled({ source: this.owner, holder: this }), sim);
    this.emit(sim, 'impale', { pos: target.pos, shake: 3, text: 'IMPALED', color: IMPALE_COLOR });
  }

  onUpdate(dt, sim) {
    const { target, weapon } = this;
    if (!target) {
      if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
      return;
    }
    if (!target.alive || sim.over || weapon.disarmed) {
      this.letGo();
      return;
    }
    // Stuck on the head, so it keeps "touching" them; don't let that count as hits.
    target.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
    this.timer -= dt;
    const held = this.holdTime - this.timer;
    if (this.timer <= 0 || (held >= this.wallHoldTime && touchesWall(this.skewerPoint(), target.radius, sim.arena))) {
      this.release(sim);
    }
  }

  // The second, weaker hit, which also flings them off the tip.
  release(sim) {
    const { target, owner, weapon } = this;
    const tip = add(owner.pos, fromAngle(this.bladeAngle(), owner.radius + weapon.gap + weapon.length));
    this.letGo();
    target.clearHitCooldown(weapon);
    this.releasing = true;
    sim.applyHit(owner, target, tip);
    this.releasing = false;
  }

  letGo() {
    this.target = null;
    this.cooldownLeft = this.cooldown;
  }

  bladeAngle() {
    const angles = this.weapon.bladeAngles();
    return angles[Math.min(this.bladeIndex, angles.length - 1)];
  }

  // Where the skewered ball's centre sits: just past the tip, with the head sunk into it.
  skewerPoint() {
    const { owner, weapon, target } = this;
    const reach = owner.radius + weapon.gap + weapon.length + target.radius * (1 - this.depth);
    return add(owner.pos, fromAngle(this.bladeAngle(), reach));
  }
}

// On a Poseidon trident. Holds the ball on the tip until the holder lets go.
export class Impaled extends Status {
  constructor({ source, holder }) {
    super({ source, duration: Infinity });
    this.holder = holder;
  }

  get expired() {
    return this.holder.target !== this.ball;
  }

  onApply() {
    this.pin();
  }

  onUpdate() {
    if (!this.expired) this.pin();
  }

  pin() {
    const point = this.holder.skewerPoint();
    this.ball.pos.x = point.x;
    this.ball.pos.y = point.y;
  }

  // A pulsing sea-blue ring.
  draw(ctx) {
    const { pos, radius } = this.ball;
    ctx.save();
    ctx.strokeStyle = IMPALE_COLOR;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.age * 25);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function nearestBlade(weapon, angle) {
  let best = 0;
  let bestGap = Infinity;
  weapon.bladeAngles().forEach((a, i) => {
    const gap = Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle)));
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

function touchesWall({ x, y }, radius, arena) {
  return x < radius || y < radius || x > arena.width - radius || y > arena.height - radius;
}

// ---- Dancer ---------------------------------------------------------------------

// The Dancer's spin: a Spin Swipe run by the Dancer upgrade alongside the
// spear's own ability (never at the same time; see Dancer.allowsAbilityStart).
class DanceSpin extends SpinSwipe {
  static displayName = 'Dance';
}

const RIBBON = '#e8579a';

export class Dancer extends SpearTransformation {
  static id = 'dancer';
  static displayName = 'Dancer';
  static description = 'Every 5 s, when the enemy is close, whirl your spear through a fast full turn (like Spin Swipe) for 30% more damage.';

  constructor(weapon) {
    super(weapon);
    this.spin = new DanceSpin(weapon);
    this.spin.cooldown = 5;
    this.spin.cooldownLeft = 2.5;
    this.spin.swipeSpinMultiplier = 5;
    this.spin.swipeDamageMultiplier = 1.3;
    this.time = 0; // for the ribbon's ripple
  }

  get spinMultiplier() {
    return this.spin.spinMultiplier;
  }

  get damageMultiplier() {
    return this.spin.damageMultiplier;
  }

  // The dance and the spear's ability (Charge Dash, or what replaced it) take
  // turns: neither starts while the other is going, so a dash can't freeze a
  // dance mid-turn and a dance can't spin a thrown spear.
  allowsAbilityStart(ability) {
    const other = ability === this.spin ? this.weapon.ability : this.spin;
    return !other?.active;
  }

  onUpdate(dt, sim) {
    this.time += dt;
    this.spin.update(dt, sim);
  }

  drawUnder(ctx) {
    this.spin.draw(ctx);
    this.drawRibbons(ctx);
  }

  // A gymnast's ribbon streaming from each spear tip. It trails further the
  // faster the spear turns, so it sweeps right round during the dance.
  drawRibbons(ctx) {
    const { owner, weapon } = this;
    if (weapon.disarmed) return;
    const reach = owner.radius + weapon.gap + weapon.length;
    const turnRate = weapon.spinSpeed * weapon.multiplier('spinMultiplier');
    const sweep = Math.min(TAU * 0.6, 0.5 + turnRate * 0.25); // radians of trail
    const steps = 28;
    ctx.save();
    ctx.strokeStyle = RIBBON;
    ctx.lineCap = 'round';
    for (const angle of weapon.bladeAngles()) {
      let prev = add(owner.pos, fromAngle(angle, reach - 6));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ripple = 9 * t * Math.sin(this.time * 11 - t * 10);
        const p = add(owner.pos, fromAngle(angle - weapon.spinDir * sweep * t, reach - 6 - 22 * t + ripple));
        ctx.globalAlpha = 0.95 - 0.6 * t;
        ctx.lineWidth = 7 - 4.5 * t;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        prev = p;
      }
    }
    ctx.restore();
  }

  // A pink flower tucked on top of the ball.
  drawOver(ctx) {
    const { x, y } = this.owner.pos;
    const center = { x: x - 20, y: y - 33 };
    ctx.save();
    ctx.fillStyle = '#ff8fc0';
    ctx.strokeStyle = '#b8336f';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const petal = add(center, fromAngle((i * TAU) / 5 - Math.PI / 2, 6));
      ctx.beginPath();
      ctx.arc(petal.x, petal.y, 5, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---- Bouncer --------------------------------------------------------------------

const PULSE_COLOR = '#b69cff';
const PULSE_TIME = 0.3; // s the ring takes to spread

export class Bouncer extends SpearTransformation {
  static id = 'bouncer';
  static displayName = 'Bouncer';
  static description = 'Landing a hit sends out a repelling pulse as far as your spear reaches, dealing 3 damage and throwing enemies straight away from you (at most once a second).';

  constructor(weapon) {
    super(weapon);
    this.pulseKnockback = 1.8; // enemies fly off at their speed x this
    this.pulseDamage = 3; // to everyone the pulse catches, on top of the hit
    this.cooldown = 1; // s between pulses
    this.cooldownLeft = 0;
    this.ring = 0; // s left of the spreading ring
    this.ringRadius = 0;
  }

  get reach() {
    const { owner, weapon } = this;
    return owner.radius + weapon.gap + weapon.length;
  }

  onUpdate(dt) {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
    if (this.ring > 0) this.ring -= dt;
  }

  onHit(target, sim) {
    if (this.cooldownLeft > 0 || sim.over) return;
    this.cooldownLeft = this.cooldown;
    const { owner } = this;
    const reach = this.reach;
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      if (enemy !== target && distance(enemy.pos, owner.pos) > reach + enemy.radius) continue;
      enemy.vel = scale(normalize(sub(enemy.pos, owner.pos)), enemy.speed * this.pulseKnockback);
      sim.dealDamage(owner, enemy, this.pulseDamage, { reason: 'pulse', color: PULSE_COLOR });
    }
    this.ring = PULSE_TIME;
    this.ringRadius = reach;
    this.emit(sim, 'pulse', { shake: 3 });
  }

  drawOver(ctx) {
    this.drawAccessories(ctx);
    if (this.ring <= 0) return;
    const { owner } = this;
    const t = 1 - this.ring / PULSE_TIME;
    ctx.save();
    ctx.strokeStyle = PULSE_COLOR;
    ctx.globalAlpha = 0.8 * (1 - t);
    ctx.lineWidth = 6 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + (this.ringRadius - owner.radius) * t, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // A club bouncer's dark shades and a coiled earpiece wire.
  drawAccessories(ctx) {
    const { x, y } = this.owner.pos;
    const r = this.owner.radius;
    const eyes = y - 21;
    ctx.save();
    ctx.lineCap = 'round';

    // Earpiece: a bud by the side of the head and a coiled wire down to the collar
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x + r - 9, eyes + 8);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      ctx.lineTo(x + r - 9 - 4 * Math.sin(t * Math.PI * 6) + 3 * t, eyes + 8 + 30 * t);
    }
    ctx.stroke();
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath();
    ctx.arc(x + r - 9, eyes + 7, 3.5, 0, TAU);
    ctx.fill();

    // Arms, then lenses with a purple sheen
    ctx.strokeStyle = '#111114';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - r + 1, eyes - 3);
    ctx.lineTo(x + r - 1, eyes - 3);
    ctx.stroke();
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#111114';
      ctx.beginPath();
      ctx.moveTo(x + dir * 3, eyes - 5);
      ctx.lineTo(x + dir * 25, eyes - 5);
      ctx.lineTo(x + dir * 22, eyes + 5);
      ctx.quadraticCurveTo(x + dir * 13, eyes + 9, x + dir * 5, eyes + 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PULSE_COLOR;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + dir * 9, eyes - 2);
      ctx.lineTo(x + dir * 18, eyes - 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

// ---- Olympian -------------------------------------------------------------------

export class Olympian extends SpearTransformation {
  static id = 'olympian';
  static displayName = 'Olympian';
  static description =
    'Charge Dash becomes Spear Throw: stand still and hurl your spear until it sticks in the wall, piercing every enemy in its path for double damage and huge knockback. Then dash to it, ramming enemies on the way. Unarmed until you pull it out.';

  apply() {
    this.weapon.ability = new SpearThrow(this.weapon);
  }

  // A victor's laurel wreath worn round the head: a ring of pointed green
  // leaves on both sides, the back half darker, tied with red ribbons.
  drawOver(ctx) {
    const { x, y } = this.owner.pos;
    const center = { x, y: y - 24 };
    const rx = this.owner.radius + 1;
    const ry = 10;
    const leaves = 14; // around the whole ring
    ctx.save();

    // Ribbon tails hanging from the knot at the back
    ctx.fillStyle = '#c62828';
    for (const dx of [-7, 3]) {
      ctx.beginPath();
      ctx.moveTo(x - rx + 3, center.y);
      ctx.quadraticCurveTo(x - rx - 8 + dx, center.y + 10, x - rx - 4 + dx, center.y + 24);
      ctx.lineTo(x - rx + 2 + dx, center.y + 22);
      ctx.quadraticCurveTo(x - rx - 1 + dx / 2, center.y + 10, x - rx + 7, center.y + 2);
      ctx.closePath();
      ctx.fill();
    }

    // Back half first, then the front half over the top of it
    for (const front of [false, true]) {
      ctx.strokeStyle = front ? '#3f6b22' : '#2c4d17';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
      ctx.stroke();
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * TAU;
        if ((Math.sin(a) >= 0) !== front) continue;
        const stem = { x: center.x + Math.cos(a) * rx, y: center.y + Math.sin(a) * ry };
        // Leaves point from the back of the head towards the front on each side.
        const along = Math.cos(a) >= 0 ? 1 : -1;
        for (const tilt of [-0.7, 0.7]) {
          const dir = fromAngle(-Math.PI / 2 + along * (Math.PI / 2 - tilt), 1);
          drawLeaf(ctx, stem, dir, front ? (tilt < 0 ? '#5c9e34' : '#79b84a') : '#3f7a25');
        }
      }
    }
    ctx.restore();
  }
}

// A pointed leaf growing from `base` in direction `dir` (a unit vector).
function drawLeaf(ctx, base, dir, color) {
  const len = 15;
  const width = 5;
  const tip = add(base, scale(dir, len));
  const mid = add(base, scale(dir, len * 0.45));
  const side = { x: -dir.y * width, y: dir.x * width };
  ctx.fillStyle = color;
  ctx.strokeStyle = '#2c4d17';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.quadraticCurveTo(mid.x + side.x, mid.y + side.y, tip.x, tip.y);
  ctx.quadraticCurveTo(mid.x - side.x, mid.y - side.y, base.x, base.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// ---- Tactician ------------------------------------------------------------------

export class Tactician extends SpearTransformation {
  static id = 'tactician';
  static displayName = 'Tactician';
  static description = 'Your spear head is longer, and hits with it always crit. Hits with the shaft deal 40% less damage.';

  constructor(weapon) {
    super(weapon);
    this.shaftDamage = 0.6;
    this.headBonus = 22; // px longer head, so more hits land with the point
  }

  apply() {
    this.weapon.headLength += this.headBonus;
  }

  // A thrown spear or a ram isn't aimed with the point, so those count as normal hits.
  critsAt(point) {
    return !this.weapon.disarmed && this.weapon.headHit(point);
  }

  damageMultiplierAt(point) {
    if (this.weapon.disarmed || this.weapon.headHit(point)) return 1;
    return this.shaftDamage;
  }

  // A general's bicorne hat, worn side to side, with gold trim and a cockade.
  drawOver(ctx) {
    const { x, y } = this.owner.pos;
    const r = this.owner.radius;
    const brim = y - r + 12;
    const wing = r + 14; // how far each point sticks out from the centre
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#2b3a67';
    ctx.strokeStyle = '#d9b54a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - wing, brim - 4);
    ctx.quadraticCurveTo(x - wing * 0.55, y - r - 8, x, y - r - 22);
    ctx.quadraticCurveTo(x + wing * 0.55, y - r - 8, x + wing, brim - 4);
    ctx.quadraticCurveTo(x, brim + 8, x - wing, brim - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cockade: a red rosette with a gold button
    const cockade = { x, y: y - r - 3 };
    ctx.fillStyle = '#c62828';
    ctx.beginPath();
    ctx.arc(cockade.x, cockade.y, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(cockade.x, cockade.y, 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d9b54a';
    ctx.beginPath();
    ctx.arc(cockade.x, cockade.y, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---- Tackler --------------------------------------------------------------------

const GUARD_BREAK_COLOR = '#ff9f43';

export class Tackler extends SpearTransformation {
  static id = 'tackler';
  static displayName = 'Tackler';
  static description = "When your spear clashes with a weapon or shield, the enemy's guard breaks for 2.5 s: their weapon and shields can't block, and weapons pass straight through them.";

  constructor(weapon) {
    super(weapon);
    this.duration = 2.5;
    this.facing = 1; // which side the helmet's face mask is on: the way the ball last moved
  }

  onParry(otherWeapon, sim) {
    const enemy = otherWeapon.owner;
    if (!enemy.alive || sim.over) return;
    enemy.addStatus(new GuardBroken({ source: this.owner, duration: this.duration }), sim);
    this.emit(sim, 'tackle', { pos: enemy.pos, text: 'GUARD BROKEN', color: GUARD_BREAK_COLOR, burst: { color: GUARD_BREAK_COLOR, count: 10, speed: 200, life: 0.35 } });
  }

  // A glossy football helmet with a stripe over the top and a face mask on
  // the side the ball is heading.
  drawOver(ctx) {
    const { pos, radius, vel } = this.owner;
    if (Math.abs(vel.x) > 30) this.facing = Math.sign(vel.x);
    const dir = this.facing;
    const { x, y } = pos;
    const r = radius + 3;
    const brow = 13; // px above the centre where the shell stops over the HP number
    const nape = 12; // px below the centre where it stops at the back
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Shell: comes down past the ear at the back, cut away over the face at the front
    const back = Math.PI / 2 + dir * (Math.PI / 2 - Math.asin(nape / r)); // angle at the back edge
    const front = -Math.PI / 2 + dir * 1.05; // angle at the front, over the eyes
    ctx.fillStyle = GUARD_BREAK_COLOR;
    ctx.strokeStyle = '#8a4a10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, back, front, dir < 0); // over the top
    const frontPoint = add(pos, fromAngle(front, r));
    ctx.lineTo(frontPoint.x - dir * 10, frontPoint.y + 4);
    ctx.lineTo(x - dir * 4, y - brow);
    ctx.quadraticCurveTo(x - dir * 22, y - brow, x - dir * 24, y + nape);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Stripe over the top, shine, and the ear hole
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r - 5, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r - 13, -Math.PI / 2 - dir * 0.9 - 0.35, -Math.PI / 2 - dir * 0.9 + 0.35);
    ctx.stroke();
    ctx.fillStyle = '#8a4a10';
    ctx.beginPath();
    ctx.arc(x - dir * 31, y - 2, 4, 0, TAU);
    ctx.fill();

    // Face mask: a curved outer bar in front of the face, joined to the shell by two bars
    ctx.strokeStyle = '#d0d4da';
    ctx.lineWidth = 3;
    const maskFrom = dir > 0 ? -0.75 : Math.PI - 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r + 7, maskFrom, maskFrom + 1.3);
    ctx.stroke();
    for (const a of [-0.35, 0.15]) {
      const angle = dir > 0 ? a : Math.PI - a;
      const inner = add(pos, fromAngle(angle, r - 10));
      const outer = add(pos, fromAngle(angle, r + 7));
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// From Tackler: the ball's weapon and shields can't block for a while.
export class GuardBroken extends Status {
  get guardBroken() {
    return true;
  }

  // Broken ring segments circling the ball, fading at the end.
  draw(ctx) {
    const { pos, radius } = this.ball;
    const pieces = 5;
    ctx.save();
    ctx.strokeStyle = GUARD_BREAK_COLOR;
    ctx.globalAlpha = 0.8 * Math.min(1, this.timeLeft / 0.3);
    ctx.lineWidth = 3;
    for (let i = 0; i < pieces; i++) {
      const a = this.age * 2 + (i * TAU) / pieces;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius + 5 + (i % 2) * 3, a, a + 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Runner ---------------------------------------------------------------------

const TRAIL_FIRE = '#ff8a3d';
const TRAIL_CORE = '#ffd23f';
const TRAIL_PIECE = 24; // px; the trail is stored in pieces about this long
const WRAP_FX = { burst: { color: TRAIL_FIRE, count: 10, speed: 160, life: 0.3 } };

// The Runner's burning ground: straight pieces that each burn for a while. It
// lives on the weapon (`weapon.fireTrail`) so whichever ability lays it, Flame
// Lap or Olympian's Spear Throw, doesn't need to know about the Runner.
class FireTrail {
  constructor() {
    // Stats. Upgrades may change these.
    this.duration = 4; // s each bit of trail burns for
    this.width = 14; // px

    this.pieces = []; // { a, b, timeLeft }
    this.time = 0; // for the flicker
  }

  // Adds burning ground from `a` to `b`, extending the last piece while it's short.
  lay(a, b) {
    if (distance(a, b) < 1e-9) return;
    const last = this.pieces.at(-1);
    if (last && distance(last.b, a) < 1e-6 && distance(last.a, last.b) < TRAIL_PIECE) {
      last.b = { ...b };
      last.timeLeft = this.duration;
      return;
    }
    this.pieces.push({ a: { ...a }, b: { ...b }, timeLeft: this.duration });
  }

  update(dt) {
    this.time += dt;
    if (this.pieces.length === 0) return;
    for (const piece of this.pieces) piece.timeLeft -= dt;
    this.pieces = this.pieces.filter((piece) => piece.timeLeft > 0);
  }

  touches(ball) {
    const reach = ball.radius + this.width / 2;
    return this.pieces.some(({ a, b }) => distance(closestPointOnSegment(ball.pos, a, b), ball.pos) < reach);
  }

  // Glowing embers along the path with flames flickering up from them.
  draw(ctx) {
    if (this.pieces.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const { a, b, timeLeft } of this.pieces) {
      const fade = Math.min(1, timeLeft / 0.6);
      ctx.globalAlpha = 0.45 * fade;
      ctx.strokeStyle = TRAIL_FIRE;
      ctx.lineWidth = this.width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 0.8 * fade;
      ctx.strokeStyle = TRAIL_CORE;
      ctx.lineWidth = this.width * 0.3;
      ctx.stroke();

      const len = distance(a, b);
      const dir = scale(sub(b, a), 1 / len);
      ctx.fillStyle = TRAIL_FIRE;
      for (let d = 4; d < len; d += 12) {
        const p = add(a, scale(dir, d));
        const h = (7 + 4 * Math.sin(this.time * 18 + p.x * 0.31 + p.y * 0.17)) * fade;
        ctx.beginPath();
        ctx.moveTo(p.x - 4, p.y);
        ctx.quadraticCurveTo(p.x - 1.5, p.y - h * 0.6, p.x, p.y - h);
        ctx.quadraticCurveTo(p.x + 1.5, p.y - h * 0.6, p.x + 4, p.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// The Runner's Charge Dash: wind up and aim the same way, then run along the
// line through the ball. At the wall ahead it comes back in where that same
// line meets the wall behind, and runs on until it's back where it started.
// The spear rams anyone in the way (once each per lap), and the ball sets the
// whole line, wall to wall, on fire.
class FlameLap extends ChargeDash {
  static displayName = 'Flame Lap';

  constructor(weapon) {
    super(weapon);

    // Stats. Upgrades may change these.
    this.runDamageMultiplier = 1.6;
    this.runKnockbackMultiplier = 1.4;

    // phase: 'windup' | 'run'
    this.lap = null; // the line being run; see lapLine()
    this.travelled = 0;
    this.struck = new Set(); // balls rammed on this lap
  }

  get damageMultiplier() {
    return this.phase === 'run' ? this.runDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'run' ? this.runKnockbackMultiplier : 1;
  }

  get unstoppable() {
    return this.phase === 'run';
  }

  onUpdate(dt, sim) {
    if (this.phase === 'run') this.updateRun(dt, sim);
    else super.onUpdate(dt, sim);
  }

  release(sim) {
    const { owner, weapon } = this;
    this.phase = 'run';
    this.lap = lapLine(owner.pos, weapon.angle, sim.arena, owner.radius);
    this.travelled = 0;
    this.struck.clear();
    owner.vel = scale(this.lap.dir, this.dashSpeed);
    this.emit(sim, 'dash', { shake: 4, burst: { color: TRAIL_FIRE, count: 16, speed: 180, life: 0.4 } });
  }

  // Sets the ball's position from how far along the lap it is, so collisions can't push it off.
  updateRun(dt, sim) {
    const { owner, weapon, lap } = this;
    const trail = weapon.fireTrail;
    const before = this.travelled;
    const after = Math.min(before + this.dashSpeed * dt, lap.length);
    this.travelled = after;

    if (before < lap.ahead && after >= lap.ahead) {
      // Out through the wall ahead, and back in through the wall behind. The
      // fire runs right up to both walls.
      trail?.lay(lapPoint(lap, before), lap.frontWall);
      moveTo(owner, lap.front);
      this.emit(sim, 'wrap', WRAP_FX);
      moveTo(owner, lap.back);
      this.emit(sim, 'wrap', WRAP_FX);
      trail?.lay(lap.backWall, lapPoint(lap, after));
    } else {
      trail?.lay(lapPoint(lap, before), lapPoint(lap, after));
    }
    weapon.angle = angleOf(lap.dir);

    if (after >= lap.length) {
      moveTo(owner, lap.origin);
      owner.vel = scale(lap.dir, owner.speed);
      this.end(sim);
      return;
    }
    moveTo(owner, lapPoint(lap, after));
    owner.vel = scale(lap.dir, this.dashSpeed);
  }

  // Each enemy is rammed at most once per lap.
  onHit(target) {
    if (this.phase !== 'run') return;
    this.struck.add(target);
    target.hitCooldowns.set(this.weapon, Infinity);
  }

  onEnd() {
    super.onEnd();
    for (const ball of this.struck) ball.clearHitCooldown(this.weapon);
    this.struck.clear();
    this.lap = null;
  }

  draw(ctx) {
    if (this.phase === 'windup') this.drawWindup(ctx);
    else if (this.phase === 'run') this.drawDash(ctx);
  }

  // The line it will run, from wall to wall.
  aimLine() {
    const { frontWall: to, backWall: from } = lapLine(this.owner.pos, this.weapon.angle, this.owner.arena, this.owner.radius);
    return { from, to };
  }
}

// The line through `origin` along `angle` for a ball of `radius` in `arena`.
// `front` and `back` are as far as the ball can go each way (touching the wall
// ahead or behind), `frontWall` and `backWall` where the line meets the walls.
// A lap is `ahead` px out to the front, then the rest of `length` from the back
// to the origin again.
function lapLine(origin, angle, arena, radius) {
  const dir = fromAngle(angle);
  const reach = (d, inset) => {
    const hi = vec(arena.width - inset, arena.height - inset);
    return Math.min(wallDistance(origin.x, d.x, inset, hi.x), wallDistance(origin.y, d.y, inset, hi.y));
  };
  const back = scale(dir, -1);
  const ahead = reach(dir, radius);
  const behind = reach(back, radius);
  return {
    origin: { ...origin },
    dir,
    front: add(origin, scale(dir, ahead)),
    back: sub(origin, scale(dir, behind)),
    frontWall: add(origin, scale(dir, reach(dir, 0))),
    backWall: sub(origin, scale(dir, reach(back, 0))),
    ahead,
    length: ahead + behind,
  };
}

// Where the ball is after running `s` px of the lap.
function lapPoint(lap, s) {
  return s < lap.ahead ? add(lap.origin, scale(lap.dir, s)) : add(lap.back, scale(lap.dir, s - lap.ahead));
}

// Distance along the path until position `p`, moving at `d` per px, reaches `lo` or `hi`.
function wallDistance(p, d, lo, hi) {
  if (d > 1e-9) return Math.max(0, (hi - p) / d);
  if (d < -1e-9) return Math.max(0, (p - lo) / -d);
  return Infinity;
}

function moveTo(ball, pos) {
  ball.pos.x = pos.x;
  ball.pos.y = pos.y;
}

export class Runner extends SpearTransformation {
  static id = 'runner';
  static displayName = 'Runner';
  static description =
    'Charge Dash becomes Flame Lap: charge along a straight line, out through the wall ahead and back in from the wall behind, until you are back where you started, ramming enemies on the way. The line catches fire from wall to wall, setting enemies burning. With Olympian, your thrown spear sets its path on fire instead.';

  constructor(weapon) {
    super(weapon);
    this.burnDamage = 1; // per tick
    this.burnTick = 0.5; // s
    this.burnDuration = 2; // s
    this.trail = new FireTrail();
  }

  apply() {
    this.weapon.fireTrail = this.trail;
    // Olympian's Spear Throw lays the trail too, so keep it if it's there.
    if (!(this.ability instanceof SpearThrow)) this.weapon.ability = new FlameLap(this.weapon);
  }

  // Burns out old trail, and sets enemies standing in it burning.
  onUpdate(dt, sim) {
    this.trail.update(dt);
    if (sim.over) return;
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner || enemy.hasStatus(Burning) || !this.trail.touches(enemy)) continue;
      const { burnDamage: damage, burnTick: tick, burnDuration: duration } = this;
      enemy.addStatus(new Burning({ source: this.owner, duration, damage, tick }), sim);
      this.emit(sim, 'ignite', { pos: enemy.pos, burst: { color: TRAIL_FIRE, count: 8, speed: 120, life: 0.35 } });
    }
  }

  drawUnder(ctx) {
    this.trail.draw(ctx);
  }

  // A sweatband round the head with a Hermes wing sprouting from each side.
  drawOver(ctx) {
    const { pos, radius } = this.owner;
    const { x, y } = pos;
    const top = y - 30;
    const height = 9;
    const edge = Math.sqrt(radius * radius - (top + height / 2 - y) ** 2);
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;

    // Wings: three feathers fanning up and back from each end of the band
    for (const dir of [-1, 1]) {
      const root = { x: x + dir * (edge - 2), y: top + height / 2 };
      for (let i = 2; i >= 0; i--) {
        const angle = -Math.PI / 2 + dir * (0.55 + i * 0.4);
        const len = 32 - i * 6;
        const mid = add(root, fromAngle(angle, len / 2));
        ctx.fillStyle = i % 2 ? '#e3e8ef' : '#ffffff';
        ctx.beginPath();
        ctx.ellipse(mid.x, mid.y, len / 2, 6, angle, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Band: white with a red stripe, clipped to the ball
    ctx.beginPath();
    ctx.arc(x, y, radius + 1, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(x - radius - 1, top, (radius + 1) * 2, height);
    ctx.fillStyle = '#d62b2b';
    ctx.fillRect(x - radius - 1, top + 3, (radius + 1) * 2, 3);
    ctx.restore();
  }
}
