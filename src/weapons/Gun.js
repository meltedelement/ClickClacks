import { Weapon } from './Weapon.js';
import { TAU, add, angleDiff, angleOf, closestPointOnSegment, closestPointsBetweenSegments, distance, fromAngle, normalize, scale, sub, turnTowards } from '../sim/math.js';
import { nearestEnemy } from '../sim/targeting.js';

const MUZZLE_TIME = 0.06; // s the muzzle flash shows for
const TRACER = '#ffe066';
const TRACER_LENGTH = 0.018; // s of flight drawn behind each bullet
const BAR_COLOR = '#ffd23f';
const BRASS = '#d9a441';

// A six-shooter. Instead of spinning freely it turns to aim at the nearest
// enemy (leading it) and fires whenever it's lined up: six quick, heavy
// rounds, each a little off true, then a long reload. Reloading, it keeps
// aiming, with the cylinder swung out and filling round by round, and a bar
// on the ball showing how far along it is. The rounds left show as pips in
// the same spot.
//
// Bullets fly in a straight line until they hit something or leave the arena.
// Each one that reaches an enemy ball is a weapon hit (crits, lifesteal,
// armor and so on all apply). Enemy blades, shields and flying drones in
// the way stop it. The gun has no melee at all: getSegments() is empty, so it
// neither hits nor blocks anything up close.
//
// Common upgrades map onto it: spin speed (Quick Spin) is how fast it turns
// to aim, `thickness` (Heavy Blade) is each bullet's hitbox half-width, and
// `length` (Long Blade) is the barrel, from whose end bullets leave.
export class Gun extends Weapon {
  static id = 'gun';
  static displayName = 'Gun';
  static hue = 320;

  constructor(owner) {
    super(owner);
    this.damage = 4; // per round
    this.spinSpeed = 5; // rad/s it turns to aim
    this.length = 34; // px, the barrel
    this.gap = 2;
    this.thickness = 3; // px, each bullet's hitbox half-width
    this.damagePerHit = 0.15;

    this.magazine = 6; // rounds per reload
    this.fireInterval = 0.18; // s between two shots
    this.reloadTime = 5.5; // s
    this.bulletSpeed = 700; // px/s
    this.aimTolerance = 0.08; // rad off target it still fires at
    this.inaccuracy = 0.3; // rad: each shot goes off up to this far either side of the barrel
    this.bulletKnockback = 0.4; // knockback multiplier: a shot jolts the target rather than launching it
    this.nudges = true; // the jolt adds to how the target was moving instead of stopping it

    this.ammo = this.magazine;
    this.fireTimer = 0; // s until it can fire again
    this.reloadLeft = 0; // s of reloading left; above 0 while reloading
    this.target = null; // the enemy it's aiming at
    this.aim = 0; // the angle it's turning towards
    this.bullets = []; // { pos, vel }
    this.flash = 0; // s left of the muzzle flash
  }

  get reloading() {
    return this.reloadLeft > 0;
  }

  // The gun shoots; the engine sees no blades.
  getSegments() {
    return [];
  }

  get bladeReach() {
    return 0;
  }

  get knockbackMultiplier() {
    return super.knockbackMultiplier * this.bulletKnockback;
  }

  onHit() {
    this.damage += this.damagePerHit;
  }

  // Turns towards where the nearest enemy will be when a bullet gets there,
  // reloading or not. With nobody left it holds still.
  turn(dt, sim) {
    this.target = sim.over ? null : nearestEnemy(this.owner, sim);
    if (!this.target) return;
    const { pos, vel } = this.target;
    const time = distance(pos, this.owner.pos) / this.bulletSpeed;
    this.aim = angleOf(sub(add(pos, scale(vel, time)), this.owner.pos));
    this.angle = turnTowards(this.angle, this.aim, this.spinSpeed * this.multiplier('spinMultiplier') * dt);
  }

  update(dt, sim) {
    super.update(dt, sim);
    if (this.flash > 0) this.flash -= dt;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (!this.reloading) {
        this.ammo = this.magazine;
        sim.onEvent('ability', { ball: this.owner, ability: null, phase: 'reload' });
      }
    } else if (this.target && this.ammo > 0 && this.fireTimer <= 0 && Math.abs(angleDiff(this.angle, this.aim)) <= this.aimTolerance) {
      this.fire(sim);
    }
    this.moveBullets(dt, sim);
  }

  // Fires one round along the barrel. An enemy pressed up against the gun is
  // hit before the bullet even leaves the barrel.
  fire(sim) {
    const { owner } = this;
    const dir = fromAngle(this.angle);
    const off = this.inaccuracy > 0 ? (Math.random() * 2 - 1) * this.inaccuracy : 0;
    const muzzle = add(owner.pos, scale(dir, owner.radius + this.gap + this.length));
    const bullet = { pos: muzzle, vel: fromAngle(this.angle + off, this.bulletSpeed) };
    this.ammo -= 1;
    this.fireTimer = this.fireInterval;
    this.flash = MUZZLE_TIME;
    sim.onEvent('ability', { ball: owner, ability: null, phase: 'gunshot', shake: 1.5 });
    if (!this.strike(bullet, add(owner.pos, scale(dir, owner.radius)), sim)) this.bullets.push(bullet);
    if (this.ammo === 0) this.startReload(sim);
  }

  // Swings the cylinder out and tips the spent brass out by the gun.
  startReload(sim) {
    const { owner } = this;
    this.reloadLeft = this.reloadTime;
    const pos = add(owner.pos, fromAngle(this.angle, owner.radius + this.gap + 12 * owner.size));
    sim.onEvent('ability', { ball: owner, ability: null, phase: 'eject', pos, burst: { color: BRASS, count: this.magazine, speed: 110, life: 0.5, size: 2 } });
  }

  // Flies every bullet on for one step, dropping the ones that hit something
  // or left the arena. In place, as this runs every step.
  moveBullets(dt, sim) {
    if (this.bullets.length === 0) return;
    const { width, height } = sim.arena;
    let kept = 0;
    for (const bullet of this.bullets) {
      const from = bullet.pos;
      bullet.pos = { x: from.x + bullet.vel.x * dt, y: from.y + bullet.vel.y * dt };
      if (!sim.over && this.strike(bullet, from, sim)) continue;
      const { x, y } = bullet.pos;
      if (x >= 0 && y >= 0 && x <= width && y <= height) this.bullets[kept++] = bullet;
    }
    this.bullets.length = kept;
  }

  // Checks `bullet`'s path this step, from `from` to where it is now. Enemy
  // blades and shields stop it (reported as a parry or a block, with no
  // hooks, like a swatted drone), and so does a drone, which it swats like a
  // blade would; otherwise it hits the first enemy ball
  // in its way. Returns true if it was stopped.
  strike(bullet, from, sim) {
    const { owner } = this;
    const to = bullet.pos;
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      const touch = this.blockedBy(from, to, enemy);
      if (touch) {
        if (touch.drone) enemy.weapon.swat(touch.drone, owner, touch.point, sim);
        else if (touch.shield) sim.onEvent('block', { attacker: owner, defender: enemy, point: touch.point });
        else sim.onEvent('parry', { a: owner, b: enemy, point: touch.point });
        return true;
      }
      const closest = closestPointOnSegment(enemy.pos, from, to);
      const away = sub(closest, enemy.pos);
      if (Math.hypot(away.x, away.y) >= enemy.radius + this.thickness) continue;
      // Strike the surface on the side the bullet came from, so the knockback carries it on.
      const dir = away.x || away.y ? normalize(away) : normalize(scale(bullet.vel, -1));
      sim.applyHit(owner, enemy, add(enemy.pos, scale(dir, enemy.radius)));
      return true;
    }
    return false;
  }

  // Where the path from `a` to `b` runs into one of `enemy`'s blades, held
  // shields or drones, as { point, shield, drone? }, or null. Follows the
  // engine's blocking rules: an unblockable weapon on either side passes
  // through blades, only ours through shields, and a guard-broken ball can't
  // block. Drones follow their own (see Drone.strike): a guarding drone
  // doesn't stop a bullet but takes its share off the hit, as usual.
  blockedBy(a, b, enemy) {
    if (this.unblockable || enemy.guardBroken) return null;
    const weapon = enemy.weapon;
    const reach = this.thickness;
    // Drones fly far from their ball, so they aren't covered by guardReach below.
    if (weapon.drones) {
      const guards = weapon.guardingDrones;
      for (const drone of weapon.drones) {
        if (!weapon.swattable(drone) || guards.includes(drone)) continue;
        const s = weapon.droneSegment(drone);
        const point = contact(a, b, s.a, s.b, reach + weapon.thickness);
        if (point) return { point, shield: false, drone };
      }
    }
    // Too far from the enemy for its blades or shields to be in the way. The usual case.
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    const gap = Math.hypot((a.x + b.x) / 2 - enemy.pos.x, (a.y + b.y) / 2 - enemy.pos.y);
    if (gap >= weapon.guardReach + reach + half + 1e-6) return null;
    if (!weapon.unblockable) {
      for (const s of weapon.getSegments()) {
        const point = contact(a, b, s.a, s.b, reach + weapon.thickness);
        if (point) return { point, shield: false };
      }
    }
    for (const shield of weapon.heldShields) {
      const s = shield.getSegment();
      const point = contact(a, b, s.a, s.b, reach + shield.thickness);
      if (point) return { point, shield: true };
    }
    return null;
  }

  // ---- Drawing ------------------------------------------------------------------

  // A revolver pointing along +x: wooden grip, frame and cylinder at `start`,
  // barrel out to `start + length`. Reloading, the cylinder is swung out to
  // the side, end on, its chambers filling as the reload goes.
  drawLocal(ctx, start) {
    const end = start + this.length;

    // Grip, angled back from the frame
    ctx.fillStyle = '#7a4f2a';
    ctx.beginPath();
    ctx.moveTo(start + 1, 1);
    ctx.lineTo(start + 9, 1);
    ctx.lineTo(start + 5, 12);
    ctx.lineTo(start - 3, 10);
    ctx.closePath();
    ctx.fill();

    // Frame and hammer
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(start, -4, 10, 6);
    ctx.fillRect(start - 2, -6, 4, 3);

    // Barrel, with a front sight
    ctx.fillStyle = '#8d949c';
    ctx.fillRect(start + 16, -2.5, end - start - 16, 5);
    ctx.fillRect(end - 4, -4.5, 2, 2);

    if (this.reloading) {
      this.drawOpenCylinder(ctx, start + 12, 11);
      return;
    }

    // Cylinder
    ctx.fillStyle = '#6f7780';
    ctx.fillRect(start + 7, -5, 11, 10);
    ctx.strokeStyle = '#3f454c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start + 7, -1.7);
    ctx.lineTo(start + 18, -1.7);
    ctx.moveTo(start + 7, 1.7);
    ctx.lineTo(start + 18, 1.7);
    ctx.stroke();
  }

  // The cylinder seen end on at (x, y), one chamber per round, the loaded ones brass.
  drawOpenCylinder(ctx, x, y) {
    const loaded = Math.floor((1 - this.reloadLeft / this.reloadTime) * this.magazine);
    ctx.strokeStyle = '#4a4f57';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, y - 6);
    ctx.stroke();
    ctx.fillStyle = '#6f7780';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, TAU);
    ctx.fill();
    for (let i = 0; i < this.magazine; i++) {
      const a = (i / this.magazine) * TAU - Math.PI / 2;
      ctx.fillStyle = i < loaded ? BRASS : '#25282d';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 1.6, 0, TAU);
      ctx.fill();
    }
  }

  draw(ctx) {
    super.draw(ctx);
    const { owner } = this;
    const size = owner.size;

    if (this.bullets.length > 0) {
      ctx.save();
      ctx.strokeStyle = TRACER;
      ctx.lineWidth = this.thickness * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const { pos, vel } of this.bullets) {
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - vel.x * TRACER_LENGTH, pos.y - vel.y * TRACER_LENGTH);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (this.flash > 0) {
      const muzzle = add(owner.pos, fromAngle(this.angle, owner.radius + this.gap + this.length + 3 * size));
      ctx.save();
      ctx.globalAlpha = this.flash / MUZZLE_TIME;
      ctx.fillStyle = '#fff6c2';
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, 6 * size, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // The reload bar (or the rounds left) inside the ball, under the HP,
    // drawn at size 1 under a canvas scaled to the ball like the gun.
    ctx.save();
    ctx.translate(owner.pos.x, owner.pos.y);
    if (size !== 1) ctx.scale(size, size);
    this.drawAmmo(ctx, owner.radius / size);
    ctx.restore();
  }

  // Centred on the ball (at the origin), `radius` px across.
  drawAmmo(ctx, radius) {
    const width = radius * 0.9;
    const height = 5;
    const left = -width / 2;
    const top = radius * 0.48;
    if (this.reloading) {
      const done = 1 - this.reloadLeft / this.reloadTime;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(left - 1, top - 1, width + 2, height + 2);
      ctx.fillStyle = BAR_COLOR;
      ctx.fillRect(left, top, width * done, height);
      return;
    }
    const spacing = 1.5;
    const pip = (width - spacing * (this.magazine - 1)) / this.magazine;
    for (let i = 0; i < this.magazine; i++) {
      ctx.fillStyle = i < this.ammo ? BAR_COLOR : 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(left + i * (pip + spacing), top, pip, height);
    }
  }

  drawHitbox(ctx) {
    super.drawHitbox(ctx);
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const { pos } of this.bullets) {
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// Midpoint of the closest approach of segments a-b and c-d, if it's under `reach`, otherwise null.
function contact(a, b, c, d, reach) {
  const { c1, c2, distance: dist } = closestPointsBetweenSegments(a, b, c, d);
  return dist < reach ? { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 } : null;
}
