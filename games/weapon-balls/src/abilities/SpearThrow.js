import { ChargeDash } from './ChargeDash.js';
import { add, closestPointOnSegment, distance, fromAngle, normalize, scale, sub, vec } from '../sim/math.js';

// Charge Dash, Olympian style (see the Olympian transformation): wind up and aim
// the same way, but then hurl the spear instead of lunging with it. The thrower
// stays put while the spear flies straight ahead until its tip sticks in the
// wall, piercing every enemy in its path (once each per throw) and launching
// them hard. Then the thrower dashes along the spear's path to pull it out,
// ramming anyone in the way. The ball is unarmed until it gets there. With the
// Runner, the spear's path catches fire (see `weapon.fireTrail`).
//
// It's a ChargeDash underneath, so Quick Charge still shortens the windup.
export class SpearThrow extends ChargeDash {
  static displayName = 'Spear Throw';

  constructor(weapon) {
    super(weapon);

    // Stats. Upgrades may change these. The dash back to the spear goes at
    // ChargeDash's `dashSpeed`.
    this.throwSpeed = 1100; // px/s
    this.throwDamageMultiplier = 2;
    this.throwKnockbackMultiplier = 3;
    this.ramDamageMultiplier = 1;
    this.ramKnockbackMultiplier = 1.6;

    // phase: 'windup' | 'throw' | 'dash'
    // While thrown, the spear lies along the line through `origin` (the ball's
    // centre at the throw) in direction `dir`. Distances along that line are
    // measured from `origin`: the spear's hilt is at `hilt`, the wall ahead at
    // `ahead`, and the hilt stops at `stuck`, where the tip meets the wall.
    // `start` is where the hilt sits when the spear is in hand.
    this.spear = null; // { origin, dir, ahead, start, hilt, stuck }
    this.pierced = new Set(); // balls the spear has gone through on this throw
    this.rammed = new Set(); // balls rammed on the dash back to it
  }

  get damageMultiplier() {
    if (this.phase === 'throw') return this.throwDamageMultiplier;
    return this.phase === 'dash' ? this.ramDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    if (this.phase === 'throw') return this.throwKnockbackMultiplier;
    return this.phase === 'dash' ? this.ramKnockbackMultiplier : 1;
  }

  get unstoppable() {
    return this.phase === 'dash';
  }

  get disarmed() {
    return this.spear !== null;
  }

  release(sim) {
    const { owner, weapon } = this;
    const origin = { ...owner.pos };
    const dir = fromAngle(weapon.angle);
    const ahead = wallDistance(origin, dir, sim.arena);
    const start = owner.radius + weapon.gap;
    // Right up against the wall, the spear is stuck as soon as it leaves the hand.
    const stuck = Math.max(start, ahead - weapon.length);
    this.phase = 'throw';
    this.spear = { origin, dir, ahead, start, hilt: start, stuck };
    this.pierced.clear();
    this.rammed.clear();
    // The fire starts under the thrower, not at the spear tip.
    this.layTrail(0, start + weapon.length);
    this.emit(sim, 'throw', { shake: 3, burst: { color: '#cfd6df', count: 10, speed: 160, life: 0.3 } });
  }

  onUpdate(dt, sim) {
    if (this.phase === 'throw') this.updateThrow(dt, sim);
    else if (this.phase === 'dash') this.updateDash(dt, sim);
    else super.onUpdate(dt, sim);
  }

  // The spear flies to the wall, through anyone in the way, while the thrower stays put.
  updateThrow(dt, sim) {
    const { owner, weapon, spear } = this;
    owner.vel = vec(0, 0);
    const before = spear.hilt;
    spear.hilt = Math.min(spear.hilt + this.throwSpeed * dt, spear.stuck);
    this.layTrail(before + weapon.length, spear.hilt + weapon.length);

    const { a, b } = this.spearSegment();
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner || sim.over || this.pierced.has(enemy)) continue;
      const point = closestPointOnSegment(enemy.pos, a, b);
      if (distance(point, enemy.pos) >= enemy.radius + weapon.thickness) continue;
      this.pierced.add(enemy);
      enemy.clearHitCooldown(weapon);
      sim.applyHit(owner, enemy, point);
    }

    if (spear.hilt >= spear.stuck) this.stick(sim);
  }

  // The tip has hit the wall: dash after it.
  stick(sim) {
    const { owner, spear } = this;
    this.phase = 'dash';
    // In case something stops the ball getting there (a corner, say), catch it anyway.
    this.timer = distance(owner.pos, this.catchPoint()) / this.dashSpeed + 0.3;
    const tip = this.at(Math.min(spear.hilt + this.weapon.length, spear.ahead));
    this.emit(sim, 'stick', { shake: 4, pos: tip, burst: { color: '#cfd6df', count: 12, speed: 200, life: 0.35 } });
    this.aimAtSpear();
  }

  // Heads for the point where the spear is back in hand, ramming enemies on
  // the way (once each). Unstoppable, so balls in the way get shoved aside,
  // and a knock off course is corrected the next step.
  updateDash(dt, sim) {
    const { owner, weapon } = this;
    this.timer -= dt;
    if (!sim.over) {
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner || this.rammed.has(enemy)) continue;
        if (distance(enemy.pos, owner.pos) >= owner.radius + enemy.radius) continue;
        this.rammed.add(enemy);
        enemy.clearHitCooldown(weapon);
        sim.applyHit(owner, enemy, add(owner.pos, scale(normalize(sub(enemy.pos, owner.pos)), owner.radius)));
      }
    }

    const target = this.catchPoint();
    if (distance(owner.pos, target) <= this.dashSpeed * dt || this.timer <= 0) {
      owner.pos.x = target.x;
      owner.pos.y = target.y;
      // Push off the wall the spear was stuck in.
      owner.vel = scale(this.spear.dir, -owner.speed);
      weapon.angle = Math.atan2(this.spear.dir.y, this.spear.dir.x);
      this.emit(sim, 'catch');
      this.end(sim);
      return;
    }
    this.aimAtSpear();
  }

  aimAtSpear() {
    const { owner } = this;
    const to = sub(this.catchPoint(), owner.pos);
    owner.vel = scale(normalize(to), this.dashSpeed);
  }

  // Where the ball's centre is once the stuck spear is back in hand.
  catchPoint() {
    return this.at(this.spear.stuck - this.spear.start);
  }

  // The point `d` px along the throw line.
  at(d) {
    return add(this.spear.origin, scale(this.spear.dir, d));
  }

  // With the Runner, the spear's tip sets its path on fire (see Runner). `from`
  // and `to` are distances along the line; nothing burns past the wall.
  layTrail(from, to) {
    const trail = this.weapon.fireTrail;
    if (!trail) return;
    to = Math.min(to, this.spear.ahead);
    if (to > from) trail.lay(this.at(from), this.at(to));
  }

  // The part of the thrown spear inside the arena.
  spearSegment() {
    const { hilt, ahead } = this.spear;
    return { a: this.at(hilt), b: this.at(Math.min(hilt + this.weapon.length, ahead)) };
  }

  // The line the spear will fly along, from the ball to the wall.
  aimLine() {
    const { owner, weapon } = this;
    const dir = fromAngle(weapon.angle);
    return {
      from: add(owner.pos, scale(dir, owner.radius + weapon.gap)),
      to: add(owner.pos, scale(dir, wallDistance(owner.pos, dir, owner.arena))),
    };
  }

  onHit() {}

  onParry() {}

  onEnd() {
    super.onEnd();
    this.spear = null;
    this.pierced.clear();
    this.rammed.clear();
  }

  // The spear in flight or stuck in the wall, drawn like it is in hand.
  drawOver(ctx) {
    if (!this.spear) return;
    const { weapon, owner } = this;
    const { dir, hilt } = this.spear;
    const pos = this.at(hilt);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, owner.arena.width, owner.arena.height);
    ctx.clip();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    ctx.scale(1, weapon.widthScale);
    weapon.drawBladeAt(ctx, 0);
    ctx.restore();
  }
}

// How far from `pos` (inside the arena) along `dir` the arena's edge is.
function wallDistance(pos, dir, arena) {
  const dx = dir.x > 1e-9 ? (arena.width - pos.x) / dir.x : dir.x < -1e-9 ? pos.x / -dir.x : Infinity;
  const dy = dir.y > 1e-9 ? (arena.height - pos.y) / dir.y : dir.y < -1e-9 ? pos.y / -dir.y : Infinity;
  return Math.max(0, Math.min(dx, dy));
}
