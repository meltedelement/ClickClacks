import { Upgrade } from './Upgrade.js';
import { Burning } from './sword-transformations.js';
import { reflectDamage, reflectedBy } from '../sim/reflect.js';
import * as looks from './drone-looks.js';
import { TAU, add, angleOf, clamp, closestPointOnSegment, closestPointsBetweenSegments, distance, dot, fromAngle, length, normalize, scale, sub } from '../sim/math.js';

// Transformations for the Drone: big upgrades that change how the swarm
// fights. Like the other weapons', they combine with each other and with the
// small upgrades, and are applied before the small ones. They work through
// the Drone's stats and its drone hooks (flyDrone, onDroneHit, onDroneSwat;
// see Drone.js).

class DroneTransformation extends Upgrade {
  static weapons = ['drone'];
  static maxStacks = 1;
  static transformation = true;
}

// ---- Non-Euclidean --------------------------------------------------------------

const PORTAL = '#a66bff';
const PORTAL_TIME = 0.35; // s a portal ring stays where a drone went through a wall

export class NonEuclidean extends DroneTransformation {
  static id = 'non-euclidean';
  static displayName = 'Non-Euclidean';
  static description = 'Drones can attack through the walls. A drone that comes through a wall always crits.';

  constructor(weapon) {
    super(weapon);
    this.last = new Map(); // drone -> where it was last step, to spot it coming through a wall
    this.portals = []; // { pos, timeLeft }
  }

  apply() {
    this.weapon.wrapsWalls = true;
    this.weapon.hull = this;
  }

  // Impossible triangles.
  drawHull(ctx, start) {
    looks.drawImpossibleDrone(ctx, start, this.weapon.length, this.owner.color);
  }

  // In a flat world, a photoreal sphere (see drawPhotoSphere).
  drawOver(ctx) {
    looks.drawPhotoSphere(ctx, this.owner);
  }

  // A violet core in each drone (when another transformation's hull is drawn).
  drawBlade(ctx, start) {
    if (this.weapon.hull === this) return;
    ctx.save();
    ctx.fillStyle = PORTAL;
    ctx.strokeStyle = '#f4f1e8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(start + this.weapon.length * 0.45, 0, 2.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // The sphere's shadow, and a ring opening where a drone left and where it came back in.
  drawUnder(ctx) {
    looks.drawSphereShadow(ctx, this.owner);
    if (this.portals.length === 0) return;
    ctx.save();
    ctx.strokeStyle = PORTAL;
    ctx.lineWidth = 3;
    for (const { pos, timeLeft } of this.portals) {
      const t = timeLeft / PORTAL_TIME;
      ctx.globalAlpha = 0.8 * t;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8 + 10 * (1 - t), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Ace ------------------------------------------------------------------------

const THRUST = 'rgba(232, 248, 255, 0.7)';

export class Ace extends DroneTransformation {
  static id = 'ace';
  static displayName = 'Ace';
  static description = 'Instead of guarding you, drones near an enemy pull you away from it.';

  constructor(weapon) {
    super(weapon);
    this.pull = 250; // px/s² each drone pulls you away from the enemy with
    this.towing = 0; // drones pulling right now
    this.time = 0; // for the exhaust flicker
  }

  // The guard becomes the thrusters: the same fan of drones facing the enemy,
  // protecting nothing, and a hit doesn't scatter it.
  apply() {
    const { weapon } = this;
    weapon.guardPerDrone = 0;
    weapon.scatters = false;
    weapon.hull = this;
  }

  // Biplanes.
  drawHull(ctx, start) {
    looks.drawBiplane(ctx, start, this.weapon.length, this.owner.color, this.weapon.clock);
  }

  onUpdate(dt, sim) {
    const { weapon, owner } = this;
    this.time += dt;
    const threat = sim.over ? null : weapon.guardTarget;
    this.towing = threat ? weapon.guardingDrones.length : 0;
    if (this.towing === 0 || weapon.controlsMovement) return;
    const away = normalize(sub(owner.pos, threat.pos));
    owner.vel = add(owner.vel, scale(away, this.pull * this.towing * dt));
  }

  // A flying cap and goggles, and propwash streaming off each pulling drone's nose.
  drawOver(ctx) {
    looks.drawAviatorCap(ctx, this.owner);
    if (this.towing === 0) return;
    const { weapon } = this;
    ctx.save();
    ctx.strokeStyle = THRUST;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5 * weapon.widthScale;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -this.time * 120;
    ctx.beginPath();
    for (const drone of weapon.guardingDrones) {
      for (const side of [-1, 1]) {
        const off = fromAngle(drone.heading + Math.PI / 2, side * 3.5 * weapon.widthScale);
        const nose = add(add(drone.pos, off), fromAngle(drone.heading, weapon.length / 2 + 3));
        const tip = add(nose, fromAngle(drone.heading, 16));
        ctx.moveTo(nose.x, nose.y);
        ctx.lineTo(tip.x, tip.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Legion ---------------------------------------------------------------------

export class Legion extends DroneTransformation {
  static id = 'legion';
  static displayName = 'Legion';
  static description = 'Twice as many smaller drones, each dealing 60% damage.';

  apply() {
    const { weapon } = this;
    weapon.blades *= 2;
    weapon.maxDrones *= 2;
    weapon.hitsPerDrone /= 2;
    weapon.length *= 0.7;
    weapon.thickness *= 0.7;
    weapon.widthScale *= 0.7;
    weapon.damage *= 0.6;
    weapon.guardPerDrone *= 0.6;
    weapon.bulletAbsorb *= 0.6;
    weapon.hull = this;
  }

  // Little insect bots.
  drawHull(ctx, start, drone) {
    const { weapon } = this;
    looks.drawBug(ctx, start, weapon.length, this.owner.color, weapon.clock, drone ? weapon.drones.indexOf(drone) * 1.7 : 0);
  }

  // Antennae.
  drawOver(ctx) {
    looks.drawAntennae(ctx, this.owner, this.weapon.clock);
  }

  // A legion-red stripe down each drone (when another transformation's hull is drawn).
  drawBlade(ctx, start) {
    if (this.weapon.hull === this) return;
    ctx.save();
    ctx.strokeStyle = '#c8262c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start + this.weapon.length * 0.3, 0);
    ctx.lineTo(start + this.weapon.length * 0.85, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Fighters -------------------------------------------------------------------

const TRACER = '#ffe066';
const CANOPY = '#9fe0ff';
const MUZZLE_TIME = 0.06; // s a muzzle flash shows for

export class Fighters extends DroneTransformation {
  static id = 'fighters';
  static displayName = 'Fighters';
  static description = 'Drones circle enemies and shoot them instead of ramming them.';
  // A fighter never touches the enemy, so it would never latch on.
  static excludedBy = ['slicers'];

  constructor(weapon) {
    super(weapon);
    this.escortGap = 25; // px outside the enemy's weapon reach they circle at...
    this.weave = 25; // ...weaving this far in and out, so they dip into reach now and then
    this.weaveRate = 2.5; // rad/s
    this.circleRate = 2.2; // rad/s round the enemy
    this.pull = 8; // how hard a drone steers for its spot on the circle (per second)
    this.escortTime = 3; // s before a drone nobody swats flies home
    this.fireInterval = 0.4; // s between one drone's shots
    this.bulletSpeed = 650; // px/s
    this.bulletRange = 380; // px
    this.bulletRadius = 3; // px
    this.bulletDamage = 0.6; // share of a drone hit

    this.bullets = []; // { pos, vel, life }
    this.shooting = false; // true while a shot's hit is dealt
  }

  apply() {
    this.weapon.hull = this;
  }

  // Sleek dark jets.
  drawHull(ctx, start) {
    looks.drawJet(ctx, start, this.weapon.length, this.owner.color);
  }

  get damageMultiplier() {
    return this.shooting ? this.bulletDamage : 1;
  }

  // How far from `enemy`'s centre its weapon reaches right now.
  reach(enemy) {
    const segments = enemy.weapon.getSegments();
    if (segments.length === 0) return enemy.radius + 40;
    let reach = enemy.radius;
    for (const { a, b } of segments) reach = Math.max(reach, distance(enemy.pos, a), distance(enemy.pos, b));
    return reach;
  }

  // An attacking drone close enough starts circling; circling ones fly here.
  flyDrone(drone, dt, sim) {
    if (drone.state === 'attack' && drone.target?.alive && distance(drone.pos, drone.target.pos) < this.reach(drone.target) + this.escortGap + this.weave) {
      this.startEscort(drone);
    }
    if (drone.state !== 'escort') return false;

    const { weapon } = this;
    const { target } = drone;
    drone.timer -= dt;
    if (!target.alive || sim.over || drone.timer <= 0) {
      weapon.rejoin(drone);
      return false;
    }
    drone.orbit += this.circleRate * drone.orbitDir * dt;
    drone.weavePhase += this.weaveRate * dt;
    const radius = this.reach(target) + this.escortGap - this.weave * Math.sin(drone.weavePhase);
    const spot = add(target.pos, fromAngle(drone.orbit, radius));
    const spotVel = add(target.vel, fromAngle(drone.orbit + (Math.PI / 2) * drone.orbitDir, radius * this.circleRate));
    const want = add(spotVel, scale(sub(spot, drone.pos), this.pull));
    const speed = clamp(length(want), weapon.minSpeed, weapon.dashSpeed * weapon.speedFactor);
    weapon.steer(drone, angleOf(want), speed, weapon.attackGrip, dt);
    weapon.move(drone, dt);

    // Enemy drones can't swat with a blade, but they can run into it.
    const { a, b } = weapon.droneSegment(drone);
    const touch = this.touchDrone(a, b, target, weapon.thickness);
    if (touch) {
      weapon.swat(drone, target, touch.point, sim);
      return true;
    }

    drone.fireTimer -= dt;
    if (drone.fireTimer <= 0) {
      drone.fireTimer += this.fireInterval;
      this.shoot(drone, target, sim);
    }
    return true;
  }

  startEscort(drone) {
    const from = sub(drone.pos, drone.target.pos);
    const heading = fromAngle(drone.heading);
    drone.state = 'escort';
    drone.orbit = angleOf(from); // its angle round the enemy
    // Circle the way it's already turning round them.
    drone.orbitDir = from.x * heading.y - from.y * heading.x >= 0 ? 1 : -1;
    drone.weavePhase = 0;
    drone.timer = this.escortTime;
    drone.fireTimer = this.fireInterval / 2;
  }

  // Fires from `drone` at where `target` will be.
  shoot(drone, target, sim) {
    const time = distance(drone.pos, target.pos) / this.bulletSpeed;
    const aim = normalize(sub(add(target.pos, scale(target.vel, time)), drone.pos));
    this.bullets.push({ pos: { ...drone.pos }, vel: scale(aim, this.bulletSpeed), life: this.bulletRange / this.bulletSpeed });
    drone.flash = MUZZLE_TIME;
    this.emit(sim, 'shoot');
  }

  onUpdate(dt, sim) {
    for (const drone of this.weapon.drones) if (drone.flash > 0) drone.flash -= dt;
    if (this.bullets.length === 0) return;
    for (const bullet of this.bullets) {
      const from = bullet.pos;
      bullet.pos = add(from, scale(bullet.vel, dt));
      bullet.life -= dt;
      if (!sim.over) this.strike(bullet, from, sim);
    }
    const { width, height } = sim.arena;
    this.bullets = this.bullets.filter(({ life, pos }) => life > 0 && pos.x >= 0 && pos.y >= 0 && pos.x <= width && pos.y <= height);
  }

  // A shot is stopped by the first enemy blade, shield or drone in its way
  // this step, or hits the first enemy ball. Shots are weapon hits (crits,
  // lifesteal...), scaled down by `bulletDamage`.
  strike(bullet, from, sim) {
    const { owner, weapon } = this;
    if (bullet.reflector) {
      this.strikeReflected(bullet, from, sim);
      return;
    }
    // A parrying ball sends the shot back at the drones' owner.
    const reflector = reflectedBy(sim, owner, from, bullet.pos);
    if (reflector) {
      bullet.reflector = reflector;
      bullet.vel = scale(normalize(sub(owner.pos, bullet.pos)), this.bulletSpeed);
      bullet.life = this.bulletRange / this.bulletSpeed;
      bullet.damage = reflectDamage(reflector, weapon.getDamage() * this.bulletDamage);
      return;
    }
    for (const enemy of sim.aliveBalls) {
      if (enemy === owner) continue;
      const touch = weapon.touch(from, bullet.pos, enemy, { reach: this.bulletRadius }) ?? this.touchDrone(from, bullet.pos, enemy);
      if (touch) {
        bullet.life = 0;
        this.emit(sim, 'ricochet', { pos: touch.point, burst: { color: TRACER, count: 4, speed: 140, life: 0.2, size: 1.5 } });
        return;
      }
      const away = sub(closestPointOnSegment(enemy.pos, from, bullet.pos), enemy.pos);
      if (length(away) >= enemy.radius + this.bulletRadius) continue;
      bullet.life = 0;
      const dir = length(away) > 1e-6 ? normalize(away) : normalize(scale(bullet.vel, -1));
      this.shooting = true;
      sim.applyHit(owner, enemy, add(enemy.pos, scale(dir, enemy.radius)));
      this.shooting = false;
      return;
    }
  }

  // A reflected shot hits the first ball but its reflector, as damage from the reflector.
  strikeReflected(bullet, from, sim) {
    const { reflector } = bullet;
    for (const enemy of sim.aliveBalls) {
      if (enemy === reflector) continue;
      if (distance(closestPointOnSegment(enemy.pos, from, bullet.pos), enemy.pos) >= enemy.radius + this.bulletRadius) continue;
      bullet.life = 0;
      sim.dealDamage(reflector, enemy, bullet.damage, { reason: 'reflect', color: '#bfe6ff' });
      return;
    }
  }

  // Where the segment from `a` to `b`, `reach` px thick, touches one of an
  // enemy Drone's drones (they have no blades for touch() to find), as
  // { point }, or null.
  touchDrone(a, b, enemy, reach = this.bulletRadius) {
    const { drones } = enemy.weapon;
    if (!drones) return null;
    for (const drone of drones) {
      if (drone.state === 'tumble') continue;
      const s = enemy.weapon.droneSegment(drone);
      const { c1, c2, distance: dist } = closestPointsBetweenSegments(a, b, s.a, s.b);
      if (dist < reach + enemy.weapon.thickness) return { point: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 } };
    }
    return null;
  }

  // A cockpit canopy on each drone (when another transformation's hull is drawn).
  drawBlade(ctx, start) {
    if (this.weapon.hull === this) return;
    const { length: len } = this.weapon;
    ctx.save();
    ctx.fillStyle = CANOPY;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(start + len * 0.62, 0, len * 0.16, 2, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // A radar sweep on the ball, tracers, and a flash at the nose of each drone that just fired.
  drawOver(ctx) {
    const { weapon } = this;
    looks.drawRadarSweep(ctx, this.owner, weapon.clock);
    ctx.save();
    ctx.lineCap = 'round';
    if (this.bullets.length > 0) {
      ctx.strokeStyle = TRACER;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const { pos, vel } of this.bullets) {
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - vel.x * 0.02, pos.y - vel.y * 0.02);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#fff6c2';
    for (const drone of weapon.drones) {
      if (!(drone.flash > 0)) continue;
      const nose = add(drone.pos, fromAngle(drone.heading, weapon.length / 2 + 2));
      ctx.beginPath();
      ctx.arc(nose.x, nose.y, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Daredevils -----------------------------------------------------------------

const TRAIL_FIRE = '#ff8a3d';
const TRAIL_CORE = '#ffd23f';
const TRAIL_PIECE = 24; // px; each drone's trail is stored in pieces about this long
const TRAIL_SHADES = 3; // fade steps the trail is drawn in, one stroke each
const TRAIL_JUMP = 100; // px; a drone that moved further than this in a step went through a wall

export class Daredevils extends DroneTransformation {
  static id = 'daredevils';
  static displayName = 'Daredevils';
  static description = 'Drones fly 50% faster and leave trails of fire.';

  constructor(weapon) {
    super(weapon);
    this.speedBoost = 0.5; // attack and catch-up speeds this much faster
    this.trailSpeed = 750; // px/s a drone has to fly faster than to leave fire
    this.trailDuration = 1; // s each bit of trail burns for
    this.trailWidth = 8; // px
    this.burnDamage = 0.5; // per tick
    this.burnTick = 0.5; // s
    this.burnDuration = 1; // s

    this.pieces = []; // { a, b, timeLeft }
    this.ends = new Map(); // drone -> { at: where it was last step, piece: the one it's extending, or null }
  }

  // Faster, and turning and speeding up twice as sharply so it still makes the turns.
  apply() {
    const { weapon } = this;
    weapon.dashSpeed *= 1 + this.speedBoost;
    weapon.flySpeed *= 1 + this.speedBoost;
    weapon.grip *= 2;
    weapon.attackGrip *= 2;
    weapon.acceleration *= 2;
    weapon.overshoot *= 1.5;
    weapon.hull = this;
  }

  // Hot rods.
  drawHull(ctx, start, drone) {
    const { weapon } = this;
    looks.drawHotRod(ctx, start, weapon.length, this.owner.color, weapon.clock, drone ? weapon.drones.indexOf(drone) * 2.3 : 0);
  }

  drawOver(ctx) {
    looks.drawBallFlames(ctx, this.owner, this.weapon.clock);
  }

  onUpdate(dt, sim) {
    for (const piece of this.pieces) piece.timeLeft -= dt;
    if (this.pieces.length > 0 && this.pieces[0].timeLeft <= 0) this.pieces = this.pieces.filter((piece) => piece.timeLeft > 0);
    for (const drone of this.weapon.drones) this.layTrail(drone);

    if (sim.over) return;
    for (const enemy of sim.aliveBalls) {
      if (enemy === this.owner || enemy.hasStatus(Burning) || !this.touches(enemy)) continue;
      const { burnDamage: damage, burnTick: tick, burnDuration: duration } = this;
      enemy.addStatus(new Burning({ source: this.owner, duration, damage, tick }), sim);
      this.emit(sim, 'ignite', { pos: enemy.pos, burst: { color: TRAIL_FIRE, count: 8, speed: 120, life: 0.35 } });
    }
  }

  // Sets the way `drone` came last step on fire if it was flying fast enough.
  // A jump (through a wall, with Non-Euclidean) starts a new piece.
  layTrail(drone) {
    const end = this.ends.get(drone);
    const at = { ...drone.pos };
    let piece = null;
    if (end && drone.speed > this.trailSpeed && drone.state !== 'tumble' && distance(end.at, at) < TRAIL_JUMP) {
      piece = end.piece;
      if (piece && piece.timeLeft > 0 && distance(piece.a, piece.b) < TRAIL_PIECE) {
        piece.b = at;
        piece.timeLeft = this.trailDuration;
      } else {
        piece = { a: end.at, b: at, timeLeft: this.trailDuration };
        this.pieces.push(piece);
      }
    }
    this.ends.set(drone, { at, piece });
  }

  touches(ball) {
    const reach = ball.radius + this.trailWidth / 2;
    return this.pieces.some(({ a, b }) => distance(closestPointOnSegment(ball.pos, a, b), ball.pos) < reach);
  }

  // Flame decals down each drone (when another transformation's hull is drawn).
  drawBlade(ctx, start) {
    if (this.weapon.hull === this) return;
    const { length: len } = this.weapon;
    ctx.save();
    ctx.fillStyle = TRAIL_FIRE;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(start + len * 0.2, side * 1);
      ctx.quadraticCurveTo(start + len * 0.45, side * 4, start + len * 0.7, side * 1.5);
      ctx.quadraticCurveTo(start + len * 0.45, side * 1.5, start + len * 0.2, side * 1);
      ctx.fill();
    }
    ctx.restore();
  }

  // The trails, faded in a few steps so each shade is one stroke.
  drawUnder(ctx) {
    if (this.pieces.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [color, width, alpha] of [[TRAIL_FIRE, this.trailWidth, 0.5], [TRAIL_CORE, this.trailWidth * 0.35, 0.85]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (let shade = 1; shade <= TRAIL_SHADES; shade++) {
        // Fading thinner as well as fainter, so the old end stays fire-coloured
        ctx.globalAlpha = alpha * (0.45 + (0.55 * shade) / TRAIL_SHADES);
        ctx.lineWidth = width * (0.35 + (0.65 * shade) / TRAIL_SHADES);
        ctx.beginPath();
        for (const { a, b, timeLeft } of this.pieces) {
          if (Math.ceil(TRAIL_SHADES * Math.min(1, timeLeft / this.trailDuration)) !== shade) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ---- Slicers --------------------------------------------------------------------

const SLICE = '#ff5d73';

export class Slicers extends DroneTransformation {
  static id = 'slicers';
  static displayName = 'Slicers';
  static description = 'Drones latch on and keep cutting until the enemy hits you, blocks something or touches a wall.';
  // A fighter never touches the enemy, so it would never latch on.
  static excludedBy = ['fighters'];

  constructor(weapon) {
    super(weapon);
    this.tick = 0.25; // s between grinds
    this.tickDamage = 0.4; // share of a drone hit per grind
    this.depth = 0.25; // share of the drone buried in the enemy
  }

  apply() {
    this.weapon.hull = this;
  }

  // Spinning saw blades.
  drawHull(ctx, start) {
    looks.drawSawDisc(ctx, start, this.weapon.length, this.owner.color, this.weapon.clock);
  }

  drawOver(ctx) {
    looks.drawSawRing(ctx, this.owner, this.weapon.clock);
  }

  onDroneHit(drone, target, sim) {
    if (!target.alive || sim.over) return;
    drone.state = 'latched';
    drone.target = target;
    drone.latch = angleOf(sub(drone.pos, target.pos)); // where on the enemy it holds on
    drone.timer = this.tick;
    drone.clash = target.weapon.parryCooldown;
    drone.speed = 0;
    this.emit(sim, 'latch', { pos: drone.pos, burst: { color: SLICE, count: 5, speed: 120, life: 0.25, size: 2 } });
  }

  // Latched drones ride along on the enemy, grinding, until it shakes them off.
  // Every parry or block the enemy's weapon makes restarts its parry
  // cooldown, which is how a clash is spotted.
  flyDrone(drone, dt, sim) {
    if (drone.state !== 'latched') return false;
    const { target } = drone;
    const clashed = target.weapon.parryCooldown > drone.clash;
    drone.clash = target.weapon.parryCooldown;
    if (!target.alive || sim.over || clashed || againstWall(target, sim.arena)) {
      this.shakeOff(drone, sim);
      return true;
    }
    drone.pos = add(target.pos, fromAngle(drone.latch, target.radius + this.weapon.length * (0.5 - this.depth)));
    drone.heading = drone.latch + Math.PI;
    drone.timer -= dt;
    if (drone.timer <= 0) {
      drone.timer += this.tick;
      sim.dealDamage(this.owner, target, this.weapon.getDamage() * this.tickDamage, { reason: 'slice', color: SLICE });
    }
    return true;
  }

  // Whoever hits you shakes off every drone latched onto them.
  onOwnerHit(attackerWeapon, sim) {
    for (const drone of this.weapon.drones) {
      if (drone.state === 'latched' && drone.target === attackerWeapon.owner) this.shakeOff(drone, sim);
    }
  }

  shakeOff(drone, sim) {
    const { weapon } = this;
    drone.state = 'tumble';
    drone.target = null;
    drone.timer = weapon.tumbleTime;
    drone.heading = drone.latch;
    drone.speed = weapon.tumbleSpeed;
    this.emit(sim, 'shake-off', { pos: drone.pos, burst: { color: SLICE, count: 4, speed: 160, life: 0.25, size: 1.5 } });
  }

  // Saw teeth along both edges of each drone (when another transformation's hull is drawn).
  drawBlade(ctx, start) {
    if (this.weapon.hull === this) return;
    const { length: len } = this.weapon;
    ctx.save();
    ctx.fillStyle = '#d9dee4';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        // Along the wing edge, from the tail tip (start, ±6) towards the nose (start + len, 0).
        const t = 0.15 + i * 0.25;
        const x = start + len * t;
        const y = side * 6 * (1 - t);
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * 0.06, y + side * 3.5);
        ctx.lineTo(x + len * 0.14, y - side * 0.8);
      }
    }
    ctx.fill();
    ctx.restore();
  }
}

// ---- Fortress -------------------------------------------------------------------

export class Fortress extends DroneTransformation {
  static id = 'fortress';
  static displayName = 'Fortress';
  static description = 'Bigger drones that take two hits to knock away and guard twice as well, but are a little slower and weaker.';

  apply() {
    const { weapon } = this;
    weapon.length *= 1.3;
    weapon.thickness *= 1.3;
    weapon.widthScale *= 1.3;
    weapon.spinSpeed *= 0.9; // the orbit, and through speedFactor every drone speed
    weapon.minSpeed *= 0.9;
    weapon.damage *= 0.9;
    weapon.guardPerDrone *= 2;
    weapon.bulletAbsorb *= 2;
    weapon.toughness += 1;
    weapon.hull = this;
  }

  // Heavy armoured drones, cracked once knocked away.
  drawHull(ctx, start, drone) {
    const { weapon } = this;
    looks.drawHeavyDrone(ctx, start, weapon.length, this.owner.color, drone && drone.toughness < weapon.toughness, weapon.clock);
  }

  // Armour plates round the ball's rim.
  drawOver(ctx) {
    looks.drawArmorRim(ctx, this.owner);
  }

  // A riveted armor plate on each drone, cracked once it has been deflected
  // (when another transformation's hull is drawn).
  drawBlade(ctx, start, drone) {
    if (this.weapon.hull === this) return;
    const { length: len, toughness } = this.weapon;
    ctx.save();
    ctx.fillStyle = '#8d949c';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start + len * 0.28, -3);
    ctx.lineTo(start + len * 0.7, -1.5);
    ctx.lineTo(start + len * 0.7, 1.5);
    ctx.lineTo(start + len * 0.28, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e3e6ea';
    for (const x of [0.36, 0.62]) {
      ctx.beginPath();
      ctx.arc(start + len * x, 0, 0.9, 0, TAU);
      ctx.fill();
    }
    if (drone && drone.toughness < toughness) {
      ctx.strokeStyle = '#1d1d22';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(start + len * 0.42, -3);
      ctx.lineTo(start + len * 0.5, -0.5);
      ctx.lineTo(start + len * 0.45, 0.8);
      ctx.lineTo(start + len * 0.55, 3);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Wingmen --------------------------------------------------------------------

export class Wingmen extends DroneTransformation {
  static id = 'wingmen';
  static displayName = 'Wingmen';
  static description = 'Gain two extra drones that ram approaching enemies away from you.';

  constructor(weapon) {
    super(weapon);
    this.count = 2;
    this.wingAngle = 1; // rad either side of the nearest enemy
    this.wingGap = 12; // px further out than the drones' orbit
    this.alert = 100; // px outside an enemy's weapon reach that a wingman goes for it
    this.pull = 8; // how hard a wingman steers for its place (per second)
    this.shove = 2.6; // the enemy is sent off at its speed × this
    this.cooldown = 0.6; // s a wingman waits after a ram before the next
    this.stagger = 0.3; // s at least between two rams
    this.maxRamTime = 0.8; // s before a ram that keeps missing gives up

    this.wingmen = []; // drones like the Drone's own (see Drone.newDrone), plus `side`
    this.lastRam = -Infinity; // sim time of the last ram
  }

  // Wingmen fly with the Drone's own flying and swatting, but outside its
  // swarm: they never launch, guard, or count as drones.
  onUpdate(dt, sim) {
    const { weapon, owner } = this;
    while (this.wingmen.length < this.count) {
      const side = this.wingmen.length % 2 === 0 ? -1 : 1;
      const wingman = weapon.newDrone(angleOf(owner.vel) + side * this.wingAngle);
      wingman.side = side;
      this.wingmen.push(wingman);
    }
    const enemy = sim.over ? null : this.nearestEnemy(sim);
    const threat = enemy && this.closingIn(enemy) ? enemy : null;
    const facing = enemy ? angleOf(sub(enemy.pos, owner.pos)) : angleOf(owner.vel) + Math.PI;
    for (const wingman of this.wingmen) {
      wingman.bounceLock = Math.max(0, wingman.bounceLock - dt);
      wingman.swatLock = Math.max(0, wingman.swatLock - dt);
      if (wingman.state === 'tumble') weapon.tumble(wingman, dt);
      else if (wingman.state === 'attack') this.flyRam(wingman, dt);
      else this.flyWing(wingman, facing, threat, dt, sim);
      weapon.move(wingman, dt);
    }
    if (!sim.over) this.strike(sim);
  }

  // True if `enemy` is coming closer and nearly within reach of the ball.
  closingIn(enemy) {
    const { owner } = this;
    const gap = distance(enemy.pos, owner.pos) - enemy.radius - owner.radius;
    if (gap > enemy.weapon.gap + enemy.weapon.length + this.alert) return false;
    return dot(sub(enemy.vel, owner.vel), normalize(sub(owner.pos, enemy.pos))) > 0;
  }

  // Keeps to its place off one side of the ball, towards `facing` (the
  // nearest enemy), and rams a threat when rested (and the other didn't just go).
  flyWing(wingman, facing, threat, dt, sim) {
    const { weapon, owner } = this;
    wingman.rest -= dt;
    const place = add(owner.pos, fromAngle(facing + wingman.side * this.wingAngle, weapon.orbitRadius + this.wingGap));
    const want = add(owner.vel, scale(sub(place, wingman.pos), this.pull));
    const speed = clamp(length(want), weapon.minSpeed, weapon.flySpeed * weapon.speedFactor);
    weapon.steer(wingman, angleOf(want), speed, weapon.grip, dt);
    if (threat && wingman.rest <= 0 && sim.time - this.lastRam >= this.stagger) {
      wingman.state = 'attack';
      wingman.target = threat;
      wingman.timer = 0;
      this.lastRam = sim.time;
    }
  }

  flyRam(wingman, dt) {
    const { weapon } = this;
    const { target } = wingman;
    wingman.timer += dt;
    if (!target?.alive || wingman.timer > this.maxRamTime) {
      weapon.rejoin(wingman, this.cooldown);
      return;
    }
    weapon.steer(wingman, angleOf(weapon.delta(wingman, target.pos)), weapon.dashSpeed * weapon.speedFactor, weapon.attackGrip, dt);
  }

  // Like the Drone's strike: blades swat and shields bounce a wingman, and
  // one on a ram that reaches an enemy ball bumps it.
  strike(sim) {
    const { weapon, owner } = this;
    for (const wingman of this.wingmen) {
      if (wingman.state === 'tumble') continue;
      const { a, b } = weapon.droneSegment(wingman);
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner) continue;
        const touch = wingman.swatLock > 0 ? null : weapon.touch(a, b, enemy, { shields: wingman.bounceLock <= 0 });
        if (touch) {
          if (touch.shield) weapon.bounce(wingman, enemy, touch.point, sim);
          else weapon.swat(wingman, enemy, touch.point, sim);
          break;
        }
        if (wingman.state !== 'attack') continue;
        if (distance(closestPointOnSegment(enemy.pos, a, b), enemy.pos) >= enemy.radius + weapon.thickness) continue;
        this.bump(wingman, enemy, sim);
        break;
      }
    }
  }

  // Sends `enemy` off directly away from you, its weapon knocked into
  // spinning the other way (unless it can't be stopped), and the wingman
  // bounces back to its place.
  bump(wingman, enemy, sim) {
    const { owner, weapon } = this;
    const toWingman = normalize(sub(wingman.pos, enemy.pos));
    if (!enemy.weapon.unstoppable) {
      enemy.vel = scale(normalize(sub(enemy.pos, owner.pos)), enemy.speed * this.shove);
      enemy.weapon.spinDir *= -1;
    }
    wingman.heading = angleOf(toWingman);
    weapon.rejoin(wingman, this.cooldown);
    this.emit(sim, 'bump', { pos: add(enemy.pos, scale(toWingman, enemy.radius)), burst: { color: owner.color, count: 8, speed: 180, life: 0.3 } });
  }

  // Rubber-rimmed pucks, whatever the drones look like, and a radar dish on
  // the ball keeping track of one.
  // Drawn at size 1 under a canvas scaled to the ball's size (see Weapon.draw).
  drawOver(ctx) {
    const { weapon, owner } = this;
    looks.drawRadarDish(ctx, owner, this.wingmen[0]?.pos, weapon.clock);
    const size = owner.size;
    owner.atUnitSize(() => {
      const start = -weapon.length / 2;
      for (const wingman of this.wingmen) {
        ctx.save();
        ctx.translate(wingman.pos.x, wingman.pos.y);
        ctx.rotate(wingman.heading + wingman.spin);
        ctx.globalAlpha = wingman.state === 'tumble' ? 0.6 : 1;
        ctx.scale(size, size * weapon.widthScale);
        looks.drawPuck(ctx, start, weapon.length, owner.color);
        ctx.restore();
      }
    });
  }
}

// ---- Helpers --------------------------------------------------------------------

// True if `ball` is up against a wall (walls leave a ball exactly touching).
function againstWall({ pos, radius }, arena) {
  const r = radius + 0.5;
  return pos.x <= r || pos.y <= r || pos.x >= arena.width - r || pos.y >= arena.height - r;
}
