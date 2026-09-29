import { ChargeDash } from './ChargeDash.js';
import { CONFIG } from '../config.js';
import { add, closestPointOnSegment, distance, fromAngle, scale, vec } from '../sim/math.js';

// Charge Dash, Olympian style (see the Olympian transformation): wind up and aim
// the same way, but then hurl the spear instead of lunging with it. The thrower
// stays put while the spear flies along the line through the ball: out through
// the wall ahead, back in through the wall behind, and on until it's back in
// hand. It pierces every enemy it meets (once each per throw), launching them
// hard. The ball is unarmed until the spear comes back. With the Runner, the
// spear's path catches fire (see `weapon.fireTrail`).
//
// It's a ChargeDash underneath, so Quick Charge still shortens the windup.
export class SpearThrow extends ChargeDash {
  static displayName = 'Spear Throw';

  constructor(weapon) {
    super(weapon);

    // Stats. Upgrades may change these.
    this.throwSpeed = 1100; // px/s
    this.throwDamageMultiplier = 2;
    this.throwKnockbackMultiplier = 3;

    // phase: 'windup' | 'throw'
    // While thrown, the spear lies along the line through `origin` (the ball's
    // centre at the throw) in direction `dir`. Distances along that line are
    // measured from `origin`: the walls are at `ahead` and -`behind`, and the
    // spear's hilt is at `hilt`. Past the wall ahead it comes back in `lap`
    // (= ahead + behind) px further back, from the wall behind.
    this.spear = null; // { origin, dir, ahead, behind, lap, hilt, start }
    this.pierced = new Set(); // balls the spear has gone through on this throw
  }

  get damageMultiplier() {
    return this.phase === 'throw' ? this.throwDamageMultiplier : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'throw' ? this.throwKnockbackMultiplier : 1;
  }

  get disarmed() {
    return this.spear !== null;
  }

  release(sim) {
    const { owner, weapon } = this;
    const origin = { ...owner.pos };
    const dir = fromAngle(weapon.angle);
    const ahead = wallDistance(origin, dir, sim.arena);
    const behind = wallDistance(origin, scale(dir, -1), sim.arena);
    const start = owner.radius + weapon.gap;
    this.phase = 'throw';
    this.spear = { origin, dir, ahead, behind, lap: ahead + behind, hilt: start, start };
    this.pierced.clear();
    this.emit(sim, 'throw', { shake: 3, burst: { color: '#cfd6df', count: 10, speed: 160, life: 0.3 } });
  }

  onUpdate(dt, sim) {
    if (this.phase === 'throw') this.updateThrow(dt, sim);
    else super.onUpdate(dt, sim);
  }

  // The spear flies its lap, through anyone in the way, while the thrower stays put.
  updateThrow(dt, sim) {
    const { owner, weapon, spear } = this;
    owner.vel = vec(0, 0);
    const before = spear.hilt;
    spear.hilt = Math.min(spear.hilt + this.throwSpeed * dt, spear.start + spear.lap);
    if (before + weapon.length <= spear.ahead && spear.hilt + weapon.length > spear.ahead) this.emit(sim, 'wrap');
    this.layTrail(before + weapon.length, spear.hilt + weapon.length);

    for (const { a, b } of this.spearSegments()) {
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner || sim.over || this.pierced.has(enemy)) continue;
        const point = closestPointOnSegment(enemy.pos, a, b);
        if (distance(point, enemy.pos) >= enemy.radius + weapon.thickness) continue;
        this.pierced.add(enemy);
        enemy.clearHitCooldown(weapon);
        sim.applyHit(owner, enemy, point);
      }
    }

    if (spear.hilt >= spear.start + spear.lap) {
      this.emit(sim, 'catch');
      this.end(sim);
    }
  }

  // With the Runner, the spear's tip sets its path on fire (see Runner). `from`
  // and `to` are distances along the line; the part past the wall ahead is
  // laid one lap back, coming in from the wall behind.
  layTrail(from, to) {
    const trail = this.weapon.fireTrail;
    if (!trail) return;
    const { origin, dir, ahead, behind, lap } = this.spear;
    const at = (d) => add(origin, scale(dir, d));
    let d = from;
    while (d < to) {
      let k = Math.floor((d + behind) / lap); // laps round so far
      let wall = ahead + k * lap;
      if (wall <= d) {
        k += 1;
        wall += lap;
      }
      const end = Math.min(to, wall);
      trail.lay(at(d - k * lap), at(end - k * lap));
      d = end;
    }
  }

  // The parts of the spear inside the arena: where it is on the line, and the
  // same shifted one lap back, which is the bit coming back in from behind.
  spearSegments() {
    const { origin, dir, ahead, behind, lap, hilt } = this.spear;
    const segments = [];
    for (const from of [hilt, hilt - lap]) {
      const lo = Math.max(from, -behind);
      const hi = Math.min(from + this.weapon.length, ahead);
      if (hi > lo) segments.push({ a: add(origin, scale(dir, lo)), b: add(origin, scale(dir, hi)) });
    }
    return segments;
  }

  // The line the spear will fly along, from wall to wall.
  aimLine() {
    const { owner, weapon } = this;
    const dir = fromAngle(weapon.angle);
    const arena = CONFIG.arena;
    return {
      from: add(owner.pos, scale(dir, -wallDistance(owner.pos, scale(dir, -1), arena))),
      to: add(owner.pos, scale(dir, wallDistance(owner.pos, dir, arena))),
    };
  }

  onHit() {}

  onParry() {}

  onEnd() {
    super.onEnd();
    this.spear = null;
    this.pierced.clear();
  }

  // The spear in flight, drawn like it is in hand, and again one lap back so
  // it slides out of one wall and in through the other.
  drawOver(ctx) {
    if (!this.spear) return;
    const { weapon } = this;
    const { origin, dir, lap, hilt } = this.spear;
    const angle = Math.atan2(dir.y, dir.x);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CONFIG.arena.width, CONFIG.arena.height);
    ctx.clip();
    for (const from of [hilt, hilt - lap]) {
      const pos = add(origin, scale(dir, from));
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(angle);
      ctx.scale(1, weapon.widthScale);
      weapon.drawLocal(ctx, 0);
      for (const upgrade of weapon.upgrades) upgrade.drawBlade(ctx, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

// How far from `pos` (inside the arena) along `dir` the arena's edge is.
function wallDistance(pos, dir, arena) {
  const dx = dir.x > 1e-9 ? (arena.width - pos.x) / dir.x : dir.x < -1e-9 ? pos.x / -dir.x : Infinity;
  const dy = dir.y > 1e-9 ? (arena.height - pos.y) / dir.y : dir.y < -1e-9 ? pos.y / -dir.y : Infinity;
  return Math.max(0, Math.min(dx, dy));
}
