import { Weapon } from './Weapon.js';
import { TAU, add, angleDiff, angleOf, closestPointOnSegment, closestPointsBetweenSegments, distance, fromAngle, normalize, scale, sub, turnTowards } from '../sim/math.js';
import { nearestEnemy } from '../sim/targeting.js';

const MUZZLE_TIME = 0.06; // s the muzzle flash shows for
const TRACER = '#ffe066';
const TRACER_LENGTH = 0.018; // s of flight drawn behind each bullet
const BAR_COLOR = '#ffd23f';
const BRASS = '#d9a441';
const MAX_PIPS = 10; // rounds shown one by one; a bigger magazine shows as a bar

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
//
// Upgrades (src/upgrades/gun.js, gun-transformations.js) reshape it through
// the stats below (`volley`, `ricochets`, `bankShots`, `bayonet`, `nearMiss`,
// `model`...) and through hooks the Gun asks its upgrades, where they have them:
//   onShot(sim)                              one round was fired (Pop Pop's free bullet)
//   onBulletMove(bullet, from, sim)          a live bullet flew from `from` to bullet.pos
//   onBulletBounce(bullet, sim)              a bullet ricocheted off a wall
//   onBulletBlocked(bullet, enemy, point, sim)  an enemy blade, shield or drone stopped it
//   onBulletNearMiss(bullet, enemy, point, sim) it passed within `nearMiss` of an enemy
// While a bullet is being dealt with, `striking` is that bullet (and
// `strikeTarget` the ball it hit, during the hit), so per-hit modifiers can
// tell its hits from the bayonet's.
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
    this.volley = false; // true: fires the whole magazine at once, fanned across the spread (Shotgun)
    this.ricochets = 0; // wall bounces a bullet makes before it's gone
    this.bankShots = false; // true: a bullet is harmless until it has bounced, and the gun aims off the walls
    this.bayonet = 0; // px of blade past the muzzle, a melee hitbox; 0 = none
    this.nearMiss = 0; // px past an enemy's edge that counts as a near miss; 0 = none
    this.model = 'revolver'; // drawing: 'revolver', 'shotgun' or 'smg'
    this.tracer = TRACER; // bullet colour

    this.ammo = this.magazine;
    this.fireTimer = 0; // s until it can fire again
    this.reloadLeft = 0; // s of reloading left; above 0 while reloading
    this.target = null; // the enemy it's aiming at
    this.aim = 0; // the angle it's turning towards
    this.bullets = []; // { pos, vel }
    this.flash = 0; // s left of the muzzle flash
    this.striking = null; // the bullet being dealt with, see above
    this.strikeTarget = null; // the ball it's hitting
  }

  get reloading() {
    return this.reloadLeft > 0;
  }

  // The gun shoots; the engine sees no blades, unless it has a bayonet: then
  // one, from the muzzle out to its tip.
  getSegments() {
    if (this.bayonet <= 0 || this.disarmed) return [];
    const { owner } = this;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const start = owner.radius + this.gap + this.length;
    const end = start + this.bayonet;
    const { x, y } = owner.pos;
    return [{ a: { x: x + cos * start, y: y + sin * start }, b: { x: x + cos * end, y: y + sin * end } }];
  }

  get bladeReach() {
    return this.bayonet > 0 ? this.owner.radius + this.gap + this.length + this.bayonet + this.thickness : 0;
  }

  // A shot jolts; a stab with the bayonet launches like any blade.
  get knockbackMultiplier() {
    return super.knockbackMultiplier * (this.striking ? this.bulletKnockback : 1);
  }

  // Every round that lands makes the next ones hit harder (bayonet stabs don't).
  onHit() {
    if (this.striking) this.damage += this.damagePerHit;
  }

  // Turns towards where the nearest enemy will be when a bullet gets there,
  // reloading or not. With nobody left it holds still.
  turn(dt, sim) {
    this.target = sim.over ? null : nearestEnemy(this.owner, sim);
    if (!this.target) return;
    this.aim = this.bankShots ? this.bankAim(this.target, sim.arena) : this.leadAim(this.target);
    this.angle = turnTowards(this.angle, this.aim, this.spinSpeed * this.multiplier('spinMultiplier') * dt);
  }

  leadAim({ pos, vel }) {
    const time = distance(pos, this.owner.pos) / this.bulletSpeed;
    return angleOf(sub(add(pos, scale(vel, time)), this.owner.pos));
  }

  // For bank shots: at the enemy's reflection in whichever wall gives the
  // shortest path, so the bullet comes off that wall at it, leading it by the
  // time that path takes.
  bankAim({ pos, vel }, { width, height }) {
    const { x, y } = this.owner.pos;
    let best = Infinity;
    let aim = 0;
    for (let wall = 0; wall < 4; wall++) {
      const sx = wall === 0 ? -1 : wall === 1 ? 1 : 0;
      const sy = wall === 2 ? -1 : wall === 3 ? 1 : 0;
      const time = Math.hypot(reflect(pos.x, sx, width) - x, reflect(pos.y, sy, height) - y) / this.bulletSpeed;
      const dx = reflect(pos.x + vel.x * time, sx, width) - x;
      const dy = reflect(pos.y + vel.y * time, sy, height) - y;
      const d = Math.hypot(dx, dy);
      if (d < best) {
        best = d;
        aim = Math.atan2(dy, dx);
      }
    }
    return aim;
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

  // Fires one round, or with `volley` every round left, fanned evenly across
  // the spread with each one jittered within its share.
  fire(sim) {
    const rounds = this.volley ? this.ammo : 1;
    this.ammo -= rounds;
    this.fireTimer = this.fireInterval;
    this.flash = MUZZLE_TIME;
    sim.onEvent('ability', { ball: this.owner, ability: null, phase: 'gunshot', shake: rounds > 1 ? 4 : 1.5 });
    for (let i = 0; i < rounds; i++) {
      this.shoot(rounds > 1 ? (((i + Math.random()) / rounds) * 2 - 1) * this.inaccuracy : this.stray(), sim);
      for (const upgrade of this.upgrades) upgrade.onShot?.(sim);
    }
    if (this.ammo === 0) this.startReload(sim);
  }

  // How far off the barrel a single shot goes, at random.
  stray() {
    return this.inaccuracy > 0 ? (Math.random() * 2 - 1) * this.inaccuracy : 0;
  }

  // Sends one bullet along the barrel, `off` rad off it. An enemy pressed up
  // against the gun is hit before the bullet even leaves the barrel.
  shoot(off, sim) {
    const { owner } = this;
    const dir = fromAngle(this.angle);
    const muzzle = add(owner.pos, scale(dir, owner.radius + this.gap + this.length));
    const bullet = { pos: muzzle, vel: fromAngle(this.angle + off, this.bulletSpeed), bounces: 0 };
    if (!this.strike(bullet, add(owner.pos, scale(dir, owner.radius)), sim)) this.bullets.push(bullet);
  }

  // Swings the cylinder out and tips the spent brass out by the gun.
  startReload(sim) {
    const { owner } = this;
    this.reloadLeft = this.reloadTime;
    const pos = add(owner.pos, fromAngle(this.angle, owner.radius + this.gap + 12 * owner.size));
    sim.onEvent('ability', { ball: owner, ability: null, phase: 'eject', pos, burst: { color: BRASS, count: Math.min(this.magazine, 10), speed: 110, life: 0.5, size: 2 } });
  }

  // Flies every bullet on for one step, dropping the ones that hit something
  // or left the arena (after any ricochets). In place, as this runs every step.
  moveBullets(dt, sim) {
    if (this.bullets.length === 0) return;
    let kept = 0;
    for (const bullet of this.bullets) {
      const from = bullet.pos;
      bullet.pos = { x: from.x + bullet.vel.x * dt, y: from.y + bullet.vel.y * dt };
      if (!sim.over && this.strike(bullet, from, sim)) continue;
      if (this.inArena(bullet, sim)) this.bullets[kept++] = bullet;
    }
    this.bullets.length = kept;
  }

  // True if `bullet` is still in the arena, after ricocheting it off a wall
  // it went through if it has a bounce left.
  inArena(bullet, sim) {
    const { width, height } = sim.arena;
    const { pos, vel } = bullet;
    const outX = pos.x < 0 || pos.x > width;
    const outY = pos.y < 0 || pos.y > height;
    if (!outX && !outY) return true;
    if (bullet.bounces >= this.ricochets) return false;
    bullet.bounces += 1;
    // Mirrored back in, as if it had bounced where it crossed the wall.
    if (outX) {
      pos.x = pos.x < 0 ? -pos.x : 2 * width - pos.x;
      vel.x = -vel.x;
    }
    if (outY) {
      pos.y = pos.y < 0 ? -pos.y : 2 * height - pos.y;
      vel.y = -vel.y;
    }
    for (const upgrade of this.upgrades) upgrade.onBulletBounce?.(bullet, sim);
    return true;
  }

  // Checks `bullet`'s path this step, from `from` to where it is now. Enemy
  // blades and shields stop it (reported as a parry or a block, with no
  // hooks but the Gun's own, like a swatted drone), and so does a drone,
  // which it swats like a blade would; otherwise it hits the first enemy ball
  // in its way, or with `nearMiss` blows up passing one. Returns true if it
  // was stopped.
  strike(bullet, from, sim) {
    this.striking = bullet;
    const stopped = this.fly(bullet, from, sim);
    this.striking = null;
    this.strikeTarget = null;
    return stopped;
  }

  fly(bullet, from, sim) {
    const { owner } = this;
    const to = bullet.pos;
    // A bank shot is harmless until it has come off a wall.
    if (this.bankShots && bullet.bounces === 0) return false;
    for (const upgrade of this.upgrades) upgrade.onBulletMove?.(bullet, from, sim);
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      const touch = this.blockedBy(from, to, enemy);
      if (touch) {
        if (touch.drone) enemy.weapon.swat(touch.drone, owner, touch.point, sim);
        else if (touch.shield) sim.onEvent('block', { attacker: owner, defender: enemy, point: touch.point });
        else sim.onEvent('parry', { a: owner, b: enemy, point: touch.point });
        for (const upgrade of this.upgrades) upgrade.onBulletBlocked?.(bullet, enemy, touch.point, sim);
        return true;
      }
      const closest = closestPointOnSegment(enemy.pos, from, to);
      const away = sub(closest, enemy.pos);
      const gap = Math.hypot(away.x, away.y);
      if (gap < enemy.radius + this.thickness) {
        // Strike the surface on the side the bullet came from, so the knockback carries it on.
        const dir = away.x || away.y ? normalize(away) : normalize(scale(bullet.vel, -1));
        this.strikeTarget = enemy;
        sim.applyHit(owner, enemy, add(enemy.pos, scale(dir, enemy.radius)));
        return true;
      }
      // Only once it's past its closest approach, not while still coming in to hit.
      if (this.nearMiss > 0 && gap < enemy.radius + this.nearMiss && passedBy(enemy.pos, from, to)) {
        for (const upgrade of this.upgrades) upgrade.onBulletNearMiss?.(bullet, enemy, closest, sim);
        return true;
      }
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

  // The bayonet grows with the ball in a royale, like the barrel.
  scaleGeometry(factor) {
    super.scaleGeometry(factor);
    this.bayonet *= factor;
  }

  saveGeometry() {
    return { ...super.saveGeometry(), bayonet: this.bayonet };
  }

  restoreGeometry(saved) {
    super.restoreGeometry(saved);
    this.bayonet = saved.bayonet;
  }

  onGrow(factor) {
    this.nearMiss *= factor;
  }

  // ---- Drawing ------------------------------------------------------------------

  drawLocal(ctx, start) {
    if (this.model === 'shotgun') this.drawShotgun(ctx, start);
    else if (this.model === 'smg') this.drawSmg(ctx, start);
    else this.drawRevolver(ctx, start);
  }

  // A revolver pointing along +x: wooden grip, frame and cylinder at `start`,
  // barrel out to `start + length`. Reloading, the cylinder is swung out to
  // the side, end on, its chambers filling as the reload goes.
  drawRevolver(ctx, start) {
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

  // A pump shotgun: stock, receiver, a long barrel over the magazine tube,
  // and a wooden fore-end that's pumped back while it reloads.
  drawShotgun(ctx, start) {
    const end = start + this.length;

    // Stock
    ctx.fillStyle = '#7a4f2a';
    ctx.beginPath();
    ctx.moveTo(start + 8, -3);
    ctx.lineTo(start - 6, -5);
    ctx.lineTo(start - 6, 6);
    ctx.lineTo(start + 8, 3);
    ctx.closePath();
    ctx.fill();

    // Receiver, barrel and magazine tube
    ctx.fillStyle = '#4a4f57';
    ctx.fillRect(start + 6, -4, 12, 8);
    ctx.fillStyle = '#8d949c';
    ctx.fillRect(start + 16, -3.5, end - start - 16, 4);
    ctx.fillStyle = '#6f7780';
    ctx.fillRect(start + 16, 0.5, end - start - 20, 3);
    ctx.fillRect(end - 3, -5, 2, 1.5);

    // Fore-end
    const pump = this.reloading ? -5 : 0;
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(start + 22 + pump, -1, 12, 6);
    ctx.strokeStyle = '#5a3a1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = start + 25 + pump; x < start + 33 + pump; x += 3) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 4);
    }
    ctx.stroke();
  }

  // A compact submachine gun: pistol grip, boxy receiver, a short shrouded
  // barrel and a straight box magazine, dropped out while it reloads.
  drawSmg(ctx, start) {
    const end = start + this.length;

    // Grip
    ctx.fillStyle = '#2f3237';
    ctx.beginPath();
    ctx.moveTo(start, 2);
    ctx.lineTo(start + 6, 2);
    ctx.lineTo(start + 3, 11);
    ctx.lineTo(start - 3, 10);
    ctx.closePath();
    ctx.fill();

    // Receiver, barrel shroud with its vent holes, barrel
    ctx.fillStyle = '#3f444b';
    ctx.fillRect(start - 2, -4.5, 22, 7.5);
    ctx.fillStyle = '#5a6068';
    ctx.fillRect(start + 18, -3.5, end - start - 24, 6);
    ctx.fillStyle = '#2a2d31';
    for (let x = start + 21; x < end - 8; x += 4) ctx.fillRect(x, -1.5, 2, 2);
    ctx.fillStyle = '#8d949c';
    ctx.fillRect(end - 6, -2, 6, 3.5);

    if (this.reloading) return;

    // Magazine
    ctx.fillStyle = '#25282d';
    ctx.fillRect(start + 10, 3, 5, 12);
    ctx.fillStyle = BRASS;
    ctx.fillRect(start + 11, 3, 3, 1.5);
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
      ctx.strokeStyle = this.tracer;
      ctx.lineWidth = this.thickness * 2;
      ctx.lineCap = 'round';
      // Bank shots that haven't bounced yet are faint: they can't hurt anyone.
      for (const live of this.bankShots ? [false, true] : [true]) {
        ctx.globalAlpha = live ? 1 : 0.35;
        ctx.beginPath();
        for (const { pos, vel, bounces } of this.bullets) {
          if (live !== (!this.bankShots || bounces > 0)) continue;
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x - vel.x * TRACER_LENGTH, pos.y - vel.y * TRACER_LENGTH);
        }
        ctx.stroke();
      }
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
    // A big magazine is one bar that empties.
    if (this.magazine > MAX_PIPS) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(left, top, width, height);
      ctx.fillStyle = BAR_COLOR;
      ctx.fillRect(left, top, (width * this.ammo) / this.magazine, height);
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

// `v` reflected in the wall at 0 (`side` -1) or at `size` (1), or left alone (0).
function reflect(v, side, size) {
  return side < 0 ? -v : side > 0 ? 2 * size - v : v;
}

// True if moving from `a` to `b` takes you past your closest approach to `p`
// (rather than still heading towards it).
function passedBy(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (p.x - a.x) * dx + (p.y - a.y) * dy < dx * dx + dy * dy;
}

// Midpoint of the closest approach of segments a-b and c-d, if it's under `reach`, otherwise null.
function contact(a, b, c, d, reach) {
  const { c1, c2, distance: dist } = closestPointsBetweenSegments(a, b, c, d);
  return dist < reach ? { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 } : null;
}
