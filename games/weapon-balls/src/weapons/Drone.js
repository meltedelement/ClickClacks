import { Weapon } from './Weapon.js';
import { Swarm } from '../abilities/Swarm.js';
import { TAU, add, angleDiff, angleOf, clamp, closestPointOnSegment, closestPointsBetweenSegments, distance, dot, fromAngle, length, normalize, scale, sub, turnTowards } from '../sim/math.js';
import { nearestEnemy } from '../sim/targeting.js';

const TRAIL = 2.2; // a drone's streak at full attack speed, in drone lengths
const BODY_HALF_WIDTH = 6; // px, the drawn triangle's half-width before widthScale

// A swarm of little triangular drones instead of a blade. They circle the ball
// until one is rested, then it peels off, swoops through the nearest enemy at
// high speed and loops back round into formation. Every few hits builds
// another drone. Enemy blades swat a drone they touch: it tumbles away and
// can't hit until it has flown back. Enemy shields only bounce it off: it keeps
// flying, but an attack it was on is over. Hits are pokes: they nudge the
// enemy (see `nudges`) rather than launching it.
//
// When an enemy comes within reach of its weapon, the drones in formation stop
// circling and lock into a tight fan on the side of the ball facing that
// enemy, noses out, turning as one to keep facing it. Each one in the guard
// takes a share off the next weapon hit on the ball, and that hit scatters
// them all. Blades and
// shields don't swat guarding drones: only a hit that gets through does.
//
// The drones fight on their own (see update), so the engine sees no blades:
// getSegments() is empty, and the drones don't block enemy weapons. Each drone
// hits a ball at most once per `hitLock`, whatever the others do, so a swarm
// passing through lands one hit per drone.
//
// Common upgrades map onto the drones: spin speed (Quick Spin, spinMultiplier)
// scales how fast they orbit and fly, `length` and `thickness` are each
// drone's size and hitbox, and `blades` is how many there are.
//
// Transformations (src/upgrades/drone-transformations.js) reshape the swarm
// through the stats below (`toughness`, `wrapsWalls`, `scatters`, the guard's...)
// and through hooks the Drone asks its upgrades, where they have them:
//   flyDrone(drone, dt, sim)            return true if it flew this drone this
//                                       step (for states of its own; call move())
//   onDroneHit(drone, target, sim)      a drone rammed `target` (after the hit)
//   onDroneSwat(drone, enemy, point, sim)  an enemy blade swatted a drone
// A drone's state is 'orbit', 'attack', 'through' or 'tumble', or one a
// transformation adds: 'escort' (Fighters: can be swatted, doesn't ram) or
// 'latched' (Slicers: neither).
export class Drone extends Weapon {
  static id = 'drone';
  static displayName = 'Drone';
  static hue = 45;

  constructor(owner) {
    super(owner);
    this.damage = 1.1;
    this.spinSpeed = 3; // orbit, rad/s; also scales every drone speed below
    this.baseSpinSpeed = this.spinSpeed;
    this.length = 16; // px, each drone nose to tail
    this.thickness = 5; // hitbox half-width, px
    this.gap = 22; // px between the ball's surface and the orbit
    this.blades = 3; // drones

    this.minSpeed = 200; // px/s; a drone never flies slower, even in formation
    this.flySpeed = 600; // px/s, top speed in formation (catching up with its slot)
    this.dashSpeed = 1000; // px/s, top speed attacking
    this.acceleration = 5; // how quickly a drone reaches the speed it wants (per second)
    this.grip = 6000; // px/s² sideways: how hard a drone can turn in formation
    this.attackGrip = 9000; // px/s² sideways while curving in on the enemy
    this.formationPull = 8; // how hard a drone steers back to its slot (per second)
    this.overshoot = 60; // px an attack carries on through the enemy before swooping back
    this.maxAttackTime = 1.2; // s before an attack that keeps missing gives up
    this.restTime = 1.5; // s a drone flies in formation before it can attack again
    this.launchGap = 0.35; // s between two drones launching
    this.hitLock = 0.35; // s before the same drone can hit the same ball again
    this.tumbleTime = 0.5; // s a swatted drone tumbles before flying back
    this.recoverTime = this.restTime; // s a swatted drone rests once it's back before it can attack again
    this.toughness = 1; // swats it takes to knock a drone away; the ones before only deflect it
    this.tumbleSpeed = 320; // px/s it's knocked away at
    this.droneKnockback = 0.2; // hits are pokes: knockback multiplier
    this.nudges = true; // the poke adds to how the enemy was moving instead of stopping it
    this.bounceLock = 0.2; // s after bouncing off a shield before a shield can bounce it again
    this.guardGap = 4; // px between the ball's surface and the drones' tails in the guard
    this.guardMargin = 30; // px outside an enemy's weapon reach that the drones start guarding
    this.guardSpacing = 1; // px between two neighbouring drones' wings in the guard
    this.guardPull = 14; // how quickly a drone snaps into its place in the guard (per second)
    this.guardTurnRate = 10; // rad/s the guard turns to keep facing the enemy
    this.guardSlack = 10; // px outside its place a drone still counts as guarding
    this.guardPerDrone = 0.06; // share of a weapon hit each guarding drone takes off
    this.maxGuard = 0.5; // most of a hit the guard can take off
    this.scatterSpeed = 420; // px/s the hit sends guarding drones flying
    this.scatters = true; // a hit that gets through scatters the guard
    this.wrapsWalls = false; // attacking drones fly out through a wall and in through the opposite one
    this.hitsPerDrone = 8; // hits to build another drone
    this.maxDrones = 8;
    this.ability = new Swarm(this);

    this.drones = [];
    this.hitCount = 0;
    this.launchTimer = 0.5; // s until the first drone may launch
    this.guardTarget = null; // the enemy the guard is facing, while one is in reach
    this.guardAngle = 0; // direction the guard faces, from the ball
    this.arena = null; // set each step, for flying through walls
    this.striker = null; // the drone whose hit is being dealt, for upgrades that care which one
  }

  // How much faster than normal the drones fly right now (Quick Spin, Swarm...).
  get speedFactor() {
    return (this.spinSpeed / this.baseSpinSpeed) * this.multiplier('spinMultiplier');
  }

  get knockbackMultiplier() {
    return super.knockbackMultiplier * this.droneKnockback;
  }

  get orbitRadius() {
    return this.owner.radius + this.gap + this.length / 2;
  }

  // Distance from the ball's centre to a guarding drone's centre.
  get guardRadius() {
    return this.owner.radius + this.guardGap + this.length / 2;
  }

  // Angle between two neighbouring drones in the guard: wing to wing at their tails.
  get guardStep() {
    const width = 2 * BODY_HALF_WIDTH * this.widthScale * this.owner.size + this.guardSpacing;
    return Math.min(width / (this.owner.radius + this.guardGap), TAU / Math.max(1, this.drones.length));
  }

  // Drones in formation close enough in to guard the ball right now.
  get guardingDrones() {
    if (!this.guardTarget) return [];
    const reach = this.guardRadius + this.guardSlack;
    return this.drones.filter((drone) => drone.state === 'orbit' && distance(drone.pos, this.owner.pos) <= reach);
  }

  // Each guarding drone takes a share off weapon hits on the ball.
  get damageTakenMultiplier() {
    return super.damageTakenMultiplier * (1 - Math.min(this.maxGuard, this.guardPerDrone * this.guardingDrones.length));
  }

  // A weapon hit got through: the guard (already counted in the damage) scatters.
  registerOwnerHit(attackerWeapon, sim, damage) {
    for (const drone of this.scatters ? this.guardingDrones : []) {
      drone.state = 'tumble';
      drone.timer = this.tumbleTime;
      drone.heading = angleOf(sub(drone.pos, this.owner.pos));
      drone.speed = this.scatterSpeed;
    }
    super.registerOwnerHit(attackerWeapon, sim, damage);
  }

  // The nearest enemy close enough to reach the ball with its weapon, or null.
  threat(sim) {
    let nearest = null;
    let best = Infinity;
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner) continue;
      const gap = distance(enemy.pos, this.owner.pos) - enemy.radius - this.owner.radius;
      if (gap < enemy.weapon.gap + enemy.weapon.length + this.guardMargin && gap < best) {
        best = gap;
        nearest = enemy;
      }
    }
    return nearest;
  }

  // Faces the guard at the threatening enemy, turning it as one piece.
  updateGuard(dt, sim) {
    const threat = sim.over ? null : this.threat(sim);
    if (threat) {
      const facing = angleOf(sub(threat.pos, this.owner.pos));
      this.guardAngle = this.guardTarget ? turnTowards(this.guardAngle, facing, this.guardTurnRate * dt) : facing;
    }
    this.guardTarget = threat;
  }

  // The drones fight on their own; the engine sees no blades.
  getSegments() {
    return [];
  }

  get bladeReach() {
    return 0;
  }

  onHit() {
    this.hitCount += 1;
    if (this.hitCount % this.hitsPerDrone === 0 && this.blades < this.maxDrones) this.blades += 1;
  }

  // ---- Flying -----------------------------------------------------------------
  //
  // A drone never stops or snaps round: it has a heading and a speed, eases
  // its speed towards what it wants, and turns at most `grip / speed` rad/s,
  // so the faster it flies the wider it curves. In formation it steers for its
  // slot on the orbit. Launched, it peels off, speeds up and curves in on the
  // enemy, carries on through for `overshoot` px and swoops back round.

  // Where drone `i` sits in formation right now.
  slotPoint(i) {
    return add(this.owner.pos, fromAngle(this.slotAngle(i), this.orbitRadius));
  }

  slotAngle(i) {
    return this.angle + (i * TAU) / this.drones.length;
  }

  update(dt, sim) {
    this.arena = sim.arena;
    // New drones (the first ones, or built by hits) take off from the ball.
    while (this.drones.length < Math.floor(this.blades)) {
      const heading = this.angle + (this.drones.length * TAU) / Math.floor(this.blades);
      this.drones.push(this.newDrone(heading));
    }
    super.update(dt, sim); // the ability may launch drones (Swarm)
    this.updateGuard(dt, sim);
    const guard = this.guardTarget ? this.guardOrder() : [];

    this.drones.forEach((drone, i) => {
      if (drone.hitLocks.size > 0) {
        for (const [ball, time] of drone.hitLocks) {
          if (time - dt <= 0) drone.hitLocks.delete(ball);
          else drone.hitLocks.set(ball, time - dt);
        }
      }
      drone.bounceLock = Math.max(0, drone.bounceLock - dt);
      drone.swatLock = Math.max(0, drone.swatLock - dt);
      if (guard.includes(drone)) {
        this.holdGuard(drone, guard.indexOf(drone), guard.length, dt);
        return;
      }
      if (this.upgrades.some((upgrade) => upgrade.flyDrone?.(drone, dt, sim))) return;
      if (drone.state === 'orbit') this.flyInFormation(drone, i, dt);
      else if (drone.state === 'attack') this.flyAttack(drone, dt);
      else if (drone.state === 'through') this.flyThrough(drone, dt);
      else this.tumble(drone, dt);
      this.move(drone, dt);
    });

    if (sim.over) return;
    this.launchTimer -= dt;
    if (this.launchTimer <= 0 && !this.ability?.active) {
      const target = nearestEnemy(this.owner, sim);
      const guards = this.guardTarget ? this.guardingDrones : [];
      const ready = this.drones.filter((drone) => drone.state === 'orbit' && drone.rest <= 0 && !guards.includes(drone));
      if (target && ready.length > 0) {
        // The drone already heading most nearly at the enemy peels off.
        const facing = (drone) => dot(fromAngle(drone.heading), normalize(this.delta(drone, target.pos)));
        this.launch(ready.reduce((best, drone) => (facing(drone) > facing(best) ? drone : best)), target);
        this.launchTimer = this.launchGap;
      }
    }
    this.strike(sim);
  }

  // A drone taking off from the ball, heading out along `heading`.
  newDrone(heading) {
    return {
      pos: { ...this.owner.pos },
      heading,
      speed: this.minSpeed,
      state: 'orbit',
      timer: 0,
      rest: this.restTime,
      target: null,
      spin: 0,
      bounceLock: 0, // s it passes through shields after bouncing off one
      swatLock: 0, // s it passes through blades after one deflected it
      toughness: this.toughness, // swats left before one knocks it away
      route: { x: 0, y: 0 }, // wrapping drones: where the enemy is reached through the walls, see delta()
      hitLocks: new Map(),
    };
  }

  // Sends `drone` swooping through `target`.
  launch(drone, target) {
    drone.state = 'attack';
    drone.target = target;
    drone.timer = 0; // s spent attacking
    drone.toughness = this.toughness;
    if (this.wrapsWalls) this.chooseRoute(drone, target.pos);
  }

  // Picks whether a wrapping drone goes straight at `point` or through the
  // walls, whichever is shorter, and keeps to it for the rest of the attack
  // so it doesn't dither while the two ways are about as long.
  chooseRoute(drone, point) {
    const { width, height } = this.arena;
    const d = sub(point, drone.pos);
    drone.route = { x: -width * Math.round(d.x / width), y: -height * Math.round(d.y / height) };
  }

  // Flies `drone` on along its heading for one step, then off (or through) the walls.
  move(drone, dt) {
    drone.pos = add(drone.pos, fromAngle(drone.heading, drone.speed * dt));
    this.bounceOffWalls(drone, this.arena);
  }

  // True while `drone` flies through walls instead of glancing off them.
  wraps(drone) {
    return this.wrapsWalls && (drone.state === 'attack' || drone.state === 'through');
  }

  // The way from `drone` to `point`: straight there, or through the walls
  // on the route a wrapping drone chose when it launched.
  delta(drone, point) {
    const d = sub(point, drone.pos);
    if (!this.wraps(drone)) return d;
    return add(d, drone.route);
  }

  // Turns towards `angle` and eases towards `speed`, as tightly as `grip` allows.
  steer(drone, angle, speed, grip, dt) {
    drone.heading = turnTowards(drone.heading, angle, (grip * this.speedFactor * dt) / Math.max(drone.speed, 1));
    drone.speed += (speed - drone.speed) * Math.min(1, this.acceleration * dt);
  }

  // Steers for the slot: the velocity that keeps pace with it, plus a pull towards it.
  flyInFormation(drone, i, dt) {
    drone.rest -= dt;
    const orbitRate = this.spinSpeed * this.multiplier('spinMultiplier') * this.spinDir;
    const slotVel = add(this.owner.vel, fromAngle(this.slotAngle(i) + Math.PI / 2, this.orbitRadius * orbitRate));
    const want = add(slotVel, scale(sub(this.slotPoint(i), drone.pos), this.formationPull));
    const speed = clamp(length(want), this.minSpeed, this.flySpeed * this.speedFactor);
    this.steer(drone, angleOf(want), speed, this.grip, dt);
  }

  // ---- Guarding ----------------------------------------------------------------
  //
  // Guarding drones don't fly: each one swings round the ball to its place in
  // the fan and is then held there rigidly, pointing straight out.

  // The drones in formation, in their order round the ball from one side of
  // the guard to the other, so none has to cross another to reach its place.
  guardOrder() {
    const side = (drone) => angleDiff(this.guardAngle, angleOf(sub(drone.pos, this.owner.pos)));
    return this.drones.filter((drone) => drone.state === 'orbit').sort((a, b) => side(a) - side(b));
  }

  // Moves drone `k` of `n` in the guard round the ball to its place.
  holdGuard(drone, k, n, dt) {
    drone.rest -= dt;
    const place = this.guardAngle + (k - (n - 1) / 2) * this.guardStep;
    const offset = sub(drone.pos, this.owner.pos);
    const ease = Math.exp(-this.guardPull * dt);
    const angle = place + angleDiff(place, angleOf(offset)) * ease;
    const radius = this.guardRadius + (length(offset) - this.guardRadius) * ease;
    drone.pos = add(this.owner.pos, fromAngle(angle, radius));
    drone.heading = angle + angleDiff(angle, drone.heading) * ease;
    drone.speed = this.minSpeed;
  }

  // Curves in on the enemy (aiming a little ahead of it) until it's past them.
  flyAttack(drone, dt) {
    const { target } = drone;
    drone.timer += dt;
    const toTarget = target?.alive ? this.delta(drone, target.pos) : null;
    if (!toTarget || dot(toTarget, fromAngle(drone.heading)) < 0 || drone.hitLocks.has(target) || drone.timer > this.maxAttackTime) {
      drone.state = 'through';
      drone.timer = this.overshoot / Math.max(drone.speed, 1);
      return;
    }
    const lead = add(target.pos, scale(target.vel, length(toTarget) / Math.max(drone.speed, 1)));
    this.steer(drone, angleOf(this.delta(drone, lead)), this.dashSpeed * this.speedFactor, this.attackGrip, dt);
  }

  // Straight on through at full speed, then back into formation, looping round
  // as it slows down.
  flyThrough(drone, dt) {
    drone.timer -= dt;
    if (drone.timer <= 0) this.rejoin(drone);
  }

  rejoin(drone, rest = this.restTime) {
    drone.state = 'orbit';
    drone.target = null;
    drone.rest = rest;
  }

  tumble(drone, dt) {
    drone.speed *= Math.exp(-4 * dt);
    drone.spin += 18 * dt;
    drone.timer -= dt;
    if (drone.timer > 0) return;
    drone.heading += drone.spin;
    drone.spin = 0;
    drone.toughness = this.toughness;
    this.rejoin(drone, this.recoverTime);
  }

  // Drones glance off the walls; an attack that hits one is over. Drones
  // that wrap come back in through the opposite wall instead.
  bounceOffWalls(drone, arena) {
    const { x, y } = drone.pos;
    if (this.wraps(drone)) {
      if (x === clamp(x, 0, arena.width) && y === clamp(y, 0, arena.height)) return;
      drone.pos = { x: wrap(x, arena.width), y: wrap(y, arena.height) };
      // Still the same way to the enemy, from this side.
      drone.route = add(drone.route, sub(drone.pos, { x, y }));
      return;
    }
    if (x < 0 || x > arena.width) drone.heading = Math.PI - drone.heading;
    if (y < 0 || y > arena.height) drone.heading = -drone.heading;
    if (x === clamp(x, 0, arena.width) && y === clamp(y, 0, arena.height)) return;
    drone.pos = { x: clamp(x, 0, arena.width), y: clamp(y, 0, arena.height) };
    if (drone.state === 'attack' || drone.state === 'through') this.rejoin(drone);
  }

  // ---- Fighting ---------------------------------------------------------------

  // Hitbox of one drone, nose to tail, in arena coordinates.
  droneSegment(drone) {
    const half = fromAngle(drone.heading + drone.spin, this.length / 2);
    return { a: sub(drone.pos, half), b: add(drone.pos, half) };
  }

  // True if `drone` can be swatted or bounced right now.
  swattable(drone) {
    return drone.state !== 'tumble' && drone.state !== 'latched';
  }

  // True if `drone` hits enemy balls it touches right now.
  rams(drone) {
    return drone.state === 'orbit' || drone.state === 'attack' || drone.state === 'through';
  }

  // Each drone that isn't tumbling or guarding is swatted by any enemy blade,
  // or bounced by any shield, it touches; otherwise it hits any enemy ball it touches.
  strike(sim) {
    const guards = this.guardingDrones;
    for (const drone of this.drones) {
      if (!this.swattable(drone) || guards.includes(drone)) continue;
      const { a, b } = this.droneSegment(drone);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
      for (const enemy of sim.aliveBalls) {
        if (enemy === this.owner) continue;
        // Out of reach of the enemy's ball, blades and shields: neither the
        // touch nor the ram below could happen. Most enemies, in a royale.
        const dx = enemy.pos.x - mx;
        const dy = enemy.pos.y - my;
        const far = Math.max(enemy.weapon.guardReach, enemy.radius) + this.thickness + half + 1;
        if (dx * dx + dy * dy > far * far) continue;
        const touch = drone.swatLock > 0 ? null : this.touch(a, b, enemy, { shields: drone.bounceLock <= 0 });
        if (touch) {
          if (touch.shield) this.bounce(drone, enemy, touch.point, sim);
          else this.swat(drone, enemy, touch.point, sim);
          break;
        }
        if (!this.rams(drone) || !enemy.alive || drone.hitLocks.has(enemy)) continue;
        const closest = closestPointOnSegment(enemy.pos, a, b);
        const away = sub(closest, enemy.pos);
        if (length(away) >= enemy.radius + this.thickness) continue;
        // Strike the surface on the drone's side, so the knockback pushes them away from it.
        const dir = length(away) > 1e-6 ? normalize(away) : fromAngle(drone.heading + Math.PI);
        drone.hitLocks.set(enemy, this.hitLock);
        this.striker = drone;
        sim.applyHit(this.owner, enemy, add(enemy.pos, scale(dir, enemy.radius)));
        this.striker = null;
        for (const upgrade of this.upgrades) upgrade.onDroneHit?.(drone, enemy, sim);
        if (!this.rams(drone)) break;
      }
    }
  }

  // Where the segment from `a` to `b` (a drone, or anything else of ours
  // `reach` px thick) touches one of `enemy`'s blades or held shields, as
  // { point, shield }, or null. Blocking follows the engine's rules: an
  // unblockable weapon on either side passes through blades, only ours
  // through shields, and a guard-broken ball can't block at all. Without
  // `shields` it passes through shields (a drone that just bounced off one).
  touch(a, b, enemy, { reach = this.thickness, shields = true } = {}) {
    const weapon = enemy.weapon;
    // Too far from the enemy for anything of theirs to reach (see Weapon.guardReach).
    // Checked first as it's the cheapest way out, and the usual one.
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    const gap = Math.hypot((a.x + b.x) / 2 - enemy.pos.x, (a.y + b.y) / 2 - enemy.pos.y);
    if (gap >= weapon.guardReach + reach + half + 1e-6) return null;
    if (this.unblockable || enemy.guardBroken) return null;
    // Blades first, then shields. Called for every drone every step, so no intermediate arrays.
    if (!weapon.unblockable) {
      for (const s of weapon.getSegments()) {
        const point = contact(a, b, s.a, s.b, reach + weapon.thickness);
        if (point) return { point, shield: false };
      }
    }
    if (shields) {
      for (const shield of weapon.heldShields) {
        const s = shield.getSegment();
        const point = contact(a, b, s.a, s.b, reach + shield.thickness);
        if (point) return { point, shield: true };
      }
    }
    return null;
  }

  // Knocks the drone away tumbling. Reported as a parry between the two
  // balls, but only the drone is affected: no spin flip, no knockback, and
  // only the drone hooks. A drone with toughness to spare is only deflected.
  swat(drone, enemy, point, sim) {
    for (const upgrade of this.upgrades) upgrade.onDroneSwat?.(drone, enemy, point, sim);
    if (drone.toughness > 1) {
      this.deflect(drone, enemy, point, sim);
      return;
    }
    const away = sub(drone.pos, point);
    const dir = length(away) > 1e-6 ? normalize(away) : fromAngle(drone.heading + Math.PI);
    drone.state = 'tumble';
    drone.target = null;
    drone.timer = this.tumbleTime;
    drone.heading = angleOf(dir);
    drone.speed = this.tumbleSpeed;
    sim.onEvent('parry', { a: this.owner, b: enemy, point });
  }

  // A swat the drone shrugs off: it glances away from the blade like it would
  // off a shield (an attack it was on is over) and passes through blades for
  // a moment, one toughness down.
  deflect(drone, enemy, point, sim) {
    const away = sub(drone.pos, point);
    drone.heading = length(away) > 1e-6 ? angleOf(away) : drone.heading + Math.PI;
    drone.toughness -= 1;
    drone.swatLock = this.bounceLock;
    if (drone.state === 'attack' || drone.state === 'through') this.rejoin(drone);
    sim.onEvent('parry', { a: this.owner, b: enemy, point });
  }

  // Glances the drone off a shield: it keeps its speed, turned away from the
  // shield, and an attack it was on is over. Reported as a block; no hooks.
  bounce(drone, enemy, point, sim) {
    const away = sub(drone.pos, point);
    drone.heading = length(away) > 1e-6 ? angleOf(away) : drone.heading + Math.PI;
    drone.bounceLock = this.bounceLock;
    if (drone.state === 'attack' || drone.state === 'through') this.rejoin(drone);
    sim.onEvent('block', { attacker: this.owner, defender: enemy, point });
  }

  // ---- Drawing ------------------------------------------------------------------

  // A dart-shaped drone pointing along +x, from `start` to `start + length`.
  drawLocal(ctx, start) {
    const end = start + this.length;
    const w = BODY_HALF_WIDTH;
    ctx.fillStyle = this.owner.color;
    ctx.strokeStyle = '#f4f1e8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(end, 0);
    ctx.lineTo(start, -w);
    ctx.lineTo(start + this.length * 0.25, 0);
    ctx.lineTo(start, w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // The drones are drawn at size 1 under a canvas scaled to the ball's size (see Weapon.draw).
  draw(ctx) {
    const size = this.owner.size;
    // A band under the drones' tails as wide as the guard, brighter the more drones hold it.
    const guards = this.guardingDrones.length;
    if (guards > 0 && this.guardPerDrone > 0) {
      const half = (guards / 2) * this.guardStep;
      ctx.save();
      ctx.strokeStyle = this.owner.color;
      ctx.globalAlpha = Math.min(0.6, 0.2 + 0.06 * guards);
      ctx.lineWidth = 3 * size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(this.owner.pos.x, this.owner.pos.y, this.owner.radius + this.guardGap, this.guardAngle - half, this.guardAngle + half);
      ctx.stroke();
      ctx.restore();
    }
    this.owner.atUnitSize(() => this.drawDrones(ctx, size));
  }

  drawDrones(ctx, size) {
    const start = -this.length / 2;
    for (const drone of this.drones) {
      ctx.save();
      ctx.translate(drone.pos.x, drone.pos.y);
      ctx.rotate(drone.heading + drone.spin);
      if (size !== 1) ctx.scale(size, size);
      // A streak behind it, growing as it speeds up past its formation speed.
      const streak = clamp((drone.speed - this.flySpeed) / Math.max(1, this.dashSpeed - this.flySpeed), 0, 1);
      if (streak > 0) {
        ctx.strokeStyle = this.owner.color;
        ctx.globalAlpha = 0.35 * streak;
        ctx.lineWidth = BODY_HALF_WIDTH * this.widthScale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(start, 0);
        ctx.lineTo(start - this.length * TRAIL * streak, 0);
        ctx.stroke();
      }
      ctx.globalAlpha = drone.state === 'tumble' ? 0.6 : 1;
      ctx.scale(1, this.widthScale);
      this.drawLocal(ctx, start);
      for (const upgrade of this.upgrades) upgrade.drawBlade(ctx, start, drone);
      ctx.restore();
    }
  }

  drawHitbox(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const drone of this.drones) {
      const { a, b } = this.droneSegment(drone);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
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

// `v` brought back into 0..size, coming in from the other side.
function wrap(v, size) {
  if (v < 0) return v + size;
  if (v > size) return v - size;
  return v;
}

