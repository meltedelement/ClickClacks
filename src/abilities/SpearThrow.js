import { ChargeDash } from './ChargeDash.js';
import { add, clamp, closestPointOnSegment, distance, fromAngle, normalize, scale, sub, vec } from '../sim/math.js';

const MAX_RETRIEVE_TIME = 1.5; // s; safety net in case it somehow never reaches the spear

// Charge Dash, Olympian style (see the Olympian transformation): wind up and aim
// the same way, but then hurl the spear instead of lunging with it. It flies
// until it hits an enemy (launching them hard) or runs out of range, and sticks
// there. Then the ball dashes over to pick it up, ramming anything in the way.
// The ball is unarmed from the throw until the pickup.
//
// It's a ChargeDash underneath, so the Charge Dash upgrades still work: Quick
// Charge shortens the windup, Long Dash lengthens the throw (its range is
// dashSpeed x dashDuration, the distance a normal dash covers).
export class SpearThrow extends ChargeDash {
  static displayName = 'Spear Throw';

  constructor(weapon) {
    super(weapon);

    // Stats. Upgrades may change these.
    this.throwSpeed = 1100; // px/s
    this.throwDamageMultiplier = 2;
    this.throwKnockbackMultiplier = 3;
    this.ramDamageMultiplier = 1.5;
    this.ramKnockbackMultiplier = 2;

    // phase: 'windup' | 'throw' | 'retrieve'
    this.spear = null; // { pos (hilt), angle, travelled } while it's out of hand
    this.rammed = new Set(); // balls already rammed on this retrieve
  }

  get throwRange() {
    return this.dashSpeed * this.dashDuration;
  }

  get damageMultiplier() {
    if (this.phase === 'throw') return this.throwDamageMultiplier;
    if (this.phase === 'retrieve') return this.ramDamageMultiplier;
    return 1;
  }

  get knockbackMultiplier() {
    if (this.phase === 'throw') return this.throwKnockbackMultiplier;
    if (this.phase === 'retrieve') return this.ramKnockbackMultiplier;
    return 1;
  }

  get disarmed() {
    return this.spear !== null;
  }

  // Charging after the spear, nothing gets in the way.
  get unstoppable() {
    return this.phase === 'retrieve';
  }

  release(sim) {
    const { owner, weapon } = this;
    this.phase = 'throw';
    this.spear = { pos: add(owner.pos, fromAngle(weapon.angle, owner.radius + weapon.gap)), angle: weapon.angle, travelled: 0 };
    this.emit(sim, 'throw', { shake: 3, burst: { color: '#cfd6df', count: 10, speed: 160, life: 0.3 } });
  }

  onUpdate(dt, sim) {
    if (this.phase === 'windup') super.onUpdate(dt, sim);
    else if (this.phase === 'throw') this.updateThrow(dt, sim);
    else if (this.phase === 'retrieve') this.updateRetrieve(dt, sim);
  }

  // The spear flies straight on while the thrower stays put.
  updateThrow(dt, sim) {
    const { owner, weapon, spear } = this;
    owner.vel = vec(0, 0);
    const step = this.throwSpeed * dt;
    spear.pos = add(spear.pos, fromAngle(spear.angle, step));
    spear.travelled += step;

    const { a, b } = this.spearSegment();
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner || sim.over || !enemy.canBeHitBy(weapon)) continue;
      const point = closestPointOnSegment(enemy.pos, a, b);
      if (distance(point, enemy.pos) >= enemy.radius + weapon.thickness) continue;
      sim.applyHit(owner, enemy, point);
      this.startRetrieve(sim);
      return;
    }

    // Out of range or into a wall: it sticks there, tip at the wall.
    const back = pullBack(b, spear.angle, sim.arena);
    if (back > 0) spear.pos = sub(spear.pos, fromAngle(spear.angle, back));
    if (back > 0 || spear.travelled >= this.throwRange) this.startRetrieve(sim);
  }

  startRetrieve(sim) {
    this.phase = 'retrieve';
    this.timer = MAX_RETRIEVE_TIME;
    this.rammed.clear();
    // Whoever the spear just hit can still be rammed on the way.
    for (const ball of sim.balls) ball.clearHitCooldown(this.weapon);
    this.emit(sim, 'dash', { shake: 4, burst: { color: '#cfd6df', count: 16, speed: 180, life: 0.4 } });
  }

  // Dash to where the ball can grab the spear by its end, ramming enemies on the way.
  updateRetrieve(dt, sim) {
    const { owner, weapon, spear } = this;
    this.timer -= dt;
    const { width, height } = sim.arena;
    const grip = sub(spear.pos, fromAngle(spear.angle, owner.radius + weapon.gap));
    const goal = vec(clamp(grip.x, owner.radius, width - owner.radius), clamp(grip.y, owner.radius, height - owner.radius));
    const toGoal = sub(goal, owner.pos);
    weapon.angle = spear.angle; // keeps any shields facing the way they were thrown

    for (const enemy of sim.aliveBalls) {
      if (enemy === owner || sim.over || this.rammed.has(enemy)) continue;
      const gap = distance(enemy.pos, owner.pos) - owner.radius - enemy.radius;
      if (gap > 2 || !enemy.canBeHitBy(weapon)) continue;
      this.rammed.add(enemy);
      const point = add(owner.pos, scale(normalize(sub(enemy.pos, owner.pos)), owner.radius));
      sim.applyHit(owner, enemy, point);
    }

    if (distance(goal, owner.pos) <= this.dashSpeed * dt || this.timer <= 0) {
      owner.vel = scale(fromAngle(spear.angle), this.dashSpeed * this.recoil);
      this.emit(sim, 'catch');
      this.end(sim);
      return;
    }
    owner.vel = scale(normalize(toGoal), this.dashSpeed);
  }

  // The flying spear's blade, like Weapon.getSegments for a single blade.
  spearSegment() {
    const { pos, angle } = this.spear;
    return { a: pos, b: add(pos, fromAngle(angle, this.weapon.length)) };
  }

  onHit() {}

  onParry() {}

  onEnd() {
    super.onEnd();
    this.spear = null;
    this.rammed.clear();
  }

  draw(ctx) {
    if (this.phase === 'windup') this.drawWindup(ctx);
    else if (this.phase === 'retrieve') this.drawDash(ctx);
  }

  // The spear in flight or stuck where it landed, drawn like it is in hand.
  drawOver(ctx) {
    if (!this.spear) return;
    const { weapon } = this;
    const { pos, angle } = this.spear;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    ctx.scale(1, weapon.widthScale);
    weapon.drawLocal(ctx, 0);
    for (const upgrade of weapon.upgrades) upgrade.drawBlade(ctx, 0);
    ctx.restore();
  }
}

// How far `tip`, travelling along `angle`, has to move back to be inside the arena (0 if it is).
function pullBack(tip, angle, arena) {
  const dir = fromAngle(angle);
  const outX = Math.max(-tip.x, tip.x - arena.width);
  const outY = Math.max(-tip.y, tip.y - arena.height);
  return Math.max(0, outX > 0 ? outX / Math.abs(dir.x) : 0, outY > 0 ? outY / Math.abs(dir.y) : 0);
}
