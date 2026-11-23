import { Upgrade } from './Upgrade.js';
import { drawFlame } from './wand-looks.js';
import { Vulnerable } from './common.js';
import { Burning } from './sword-transformations.js';
import { CONFIG } from '../config.js';
import { TAU, closestPointOnSegment, distance, hypot } from '../sim/math.js';
import { projectileBlockedBy } from '../weapons/projectile.js';

// Transformations for the Tome. Like the other weapons', they combine with
// each other and with the small upgrades, and are applied before the small
// ones. They work through the Tome's portals and tentacles (see Tome.js):
// `portals` and `tentacles` (read them, don't change them: open one with
// `openPortal(wallPortalAt(pos, arena), sim)` and shut one with
// `closePortal`), `tipOf(tentacle)`, `damage` (a lash's, which grows),
// `tentacleWidth`, `maxPortals` and `holy` (Priest's look).
//
// Most add damage of their own outside the tentacles. Hits that count as the
// Tome's (abyss circles, detonations, the pentagram, claws, the familiar's
// pecks) go through `sim.applySecondaryHit`, so damage upgrades, crits,
// Armor and Lifesteal apply; the lava pool burns with `sim.dealDamage`.

class TomeTransformation extends Upgrade {
  static weapons = ['tome'];
  static maxStacks = 1;
  static transformation = true;
}

// Puts the canvas in `ball`'s own frame for a costume: its centre at the
// origin and at size 1, so the costume grows with it in a royale. Returns the
// ball's radius in that frame. Pair it with ctx.restore().
function costumeFrame(ctx, ball) {
  ctx.save();
  ctx.translate(ball.pos.x, ball.pos.y);
  ctx.scale(ball.size, ball.size);
  return ball.radius / ball.size;
}

// True if `ball` touches the segment a-b, `width` px either side of it.
function touchesSegment(ball, a, b, width) {
  const point = closestPointOnSegment(ball.pos, a, b);
  return distance(ball.pos, point) < ball.radius + width;
}

// ---- Abyss Warlock -----------------------------------------------------------------

const ABYSS = '#9b3dff';
const ABYSS_DARK = '#12051f';
const ABYSS_GLOW = '#d6a8ff';
const ABYSS_SHARE = 0.4; // of a lash's damage, per tentacle touching the circle, per tick

export class AbyssWarlock extends TomeTransformation {
  static id = 'abyss-warlock';
  static displayName = 'Abyss Warlock';
  static description = `Wherever two tentacles cross, an abyss opens: a circle that hurts anyone in it every ${0.4}s, for ${ABYSS_SHARE * 100}% of a lash's damage per tentacle touching it.`;

  constructor(weapon) {
    super(weapon);
    this.radius = 55; // px
    this.tick = 0.4; // s between the abysses' hits
    this.tickLeft = this.tick;
    // The open abysses, worked out again every step: { x, y, count }. Only
    // the first `count` are in use, so the objects are reused.
    this.circles = [];
    this.count = 0;
    this.time = 0; // drawing only
  }

  onUpdate(dt, sim) {
    this.time += dt;
    this.findCircles();
    if (sim.over || this.count === 0) {
      this.tickLeft = this.tick;
      return;
    }
    this.tickLeft -= dt;
    if (this.tickLeft > 0) return;
    this.tickLeft += this.tick;
    const { owner, weapon } = this;
    const radius = this.radius * owner.size;
    for (let i = 0; i < this.count; i++) {
      const circle = this.circles[i];
      const damage = weapon.damage * ABYSS_SHARE * circle.count;
      for (const enemy of [...sim.aliveBalls]) {
        if (enemy === owner || !enemy.alive) continue;
        if (distance(enemy.pos, circle) >= enemy.radius + radius) continue;
        sim.applySecondaryHit(owner, enemy, damage, { reason: 'abyss', color: ABYSS });
        if (sim.over) return;
      }
    }
  }

  // Every point where two tentacles (as far as they've reached) cross, away
  // from the portals they share, and how many tentacles touch a circle there.
  // Crossings inside a circle already found are left to it.
  findCircles() {
    const { weapon, owner } = this;
    const { tentacles } = weapon;
    this.count = 0;
    if (tentacles.length < 2) return;
    const radius = this.radius * owner.size;
    for (let i = 0; i < tentacles.length; i++) {
      const a = tentacles[i];
      const aTip = weapon.tipOf(a);
      for (let j = i + 1; j < tentacles.length; j++) {
        const b = tentacles[j];
        const bTip = weapon.tipOf(b);
        const cross = crossing(a.from, aTip, b.from, bTip);
        if (!cross) continue;
        let known = false;
        for (let k = 0; k < this.count; k++) if (distance(this.circles[k], cross) < radius) known = true;
        if (known) continue;
        let count = 0;
        for (const t of tentacles) if (distance(closestPointOnSegment(cross, t.from, weapon.tipOf(t)), cross) < radius) count++;
        if (this.count === this.circles.length) this.circles.push({ x: 0, y: 0, count: 0 });
        const circle = this.circles[this.count++];
        circle.x = cross.x;
        circle.y = cross.y;
        circle.count = count;
      }
    }
  }

  // A dark well with a violet rim and a slow swirl, deeper the more tentacles feed it.
  drawUnder(ctx) {
    if (this.count === 0) return;
    const radius = this.radius * this.owner.size;
    ctx.save();
    for (let i = 0; i < this.count; i++) {
      const { x, y, count } = this.circles[i];
      const depth = Math.min(1, 0.5 + 0.25 * (count - 1));
      ctx.globalAlpha = 0.25 * depth;
      ctx.fillStyle = ABYSS;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.15, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.75 * depth;
      ctx.fillStyle = ABYSS_DARK;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
      // A glowing rim, and three arms of light swirling down into it
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = ABYSS;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ABYSS_GLOW;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const a = -this.time * 2 + (k * TAU) / 3;
        ctx.strokeStyle = k === 0 ? ABYSS_GLOW : ABYSS;
        ctx.globalAlpha = 0.85 * depth;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        // A spiral arm, from the rim in towards the middle
        for (let j = 0; j <= 8; j++) {
          const f = j / 8;
          const ra = radius * (0.92 - 0.8 * f);
          const aa = a + f * 2.6;
          if (j === 0) ctx.moveTo(x + Math.cos(aa) * ra, y + Math.sin(aa) * ra);
          else ctx.lineTo(x + Math.cos(aa) * ra, y + Math.sin(aa) * ra);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // An eldritch crown in flat colours: a cap of dark iron hugging the top of
  // the head with violet studs along its edge, three spires, two tentacles
  // curling up out of the sides, and a violet eye in the front that looks
  // about and blinks.
  drawOver(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const t = this.time;
    const rim = -r * 0.42; // the cap's straight bottom edge
    const side = Math.sqrt(r * r - rim * rim);
    const rimAngle = Math.atan2(rim, side); // where the edge meets the ball, right side
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = WARLOCK_LINE;

    // Tentacles, behind the cap: a tapering curve each, curling outward
    for (const dir of [-1, 1]) {
      // The centre line: from the side of the cap, heading up and turning
      // outward more and more, so the tip curls over
      const n = 12;
      const step = (r * 1.05) / n;
      const sway = 0.3 * Math.sin(t * 2.2 + dir);
      let x = dir * r * 0.72;
      let y = rim - 6;
      let heading = -Math.PI / 2 + dir * 0.15;
      const left = [];
      const right = [];
      for (let j = 0; j <= n; j++) {
        const f = j / n;
        const w = 6 * (1 - f) + 0.8;
        const nx = -Math.sin(heading);
        const ny = Math.cos(heading);
        left.push(x + nx * w, y + ny * w);
        right.push(x - nx * w, y - ny * w);
        heading += dir * (0.05 + 0.3 * f + 0.06 * sway);
        x += Math.cos(heading) * step;
        y += Math.sin(heading) * step;
      }
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let k = 2; k < left.length; k += 2) ctx.lineTo(left[k], left[k + 1]);
      for (let k = right.length - 2; k >= 0; k -= 2) ctx.lineTo(right[k], right[k + 1]);
      ctx.closePath();
      ctx.fillStyle = WARLOCK_TENTACLE;
      ctx.fill();
      ctx.stroke();
      // Suckers down its inner side
      ctx.fillStyle = ABYSS_GLOW;
      const inner = dir > 0 ? left : right;
      for (const j of [2, 4, 6]) {
        const ox = (left[j * 2] + right[j * 2]) / 2;
        const oy = (left[j * 2 + 1] + right[j * 2 + 1]) / 2;
        ctx.beginPath();
        ctx.arc((ox + inner[j * 2]) / 2, (oy + inner[j * 2 + 1]) / 2, 1.3, 0, TAU);
        ctx.fill();
      }
    }

    // Spires, rising from the top of the cap
    for (const [k, h] of [
      [-0.45, 13],
      [0, 20],
      [0.45, 13],
    ]) {
      const x = k * r;
      const top = -Math.sqrt(r * r - x * x) - 2;
      ctx.beginPath();
      ctx.moveTo(x - 6, top + 4);
      ctx.lineTo(x + k * 6, top - h);
      ctx.lineTo(x + 6, top + 4);
      ctx.closePath();
      ctx.fillStyle = WARLOCK_IRON;
      ctx.fill();
      ctx.stroke();
    }

    // The cap: the top of the ball above the rim, a little proud of it
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, Math.PI - rimAngle, rimAngle);
    ctx.closePath();
    ctx.fillStyle = WARLOCK_IRON;
    ctx.fill();
    ctx.stroke();
    // A band along the rim, with studs
    ctx.fillStyle = WARLOCK_BAND;
    ctx.fillRect(-side - 1, rim - 6, side * 2 + 2, 6);
    ctx.strokeRect(-side - 1, rim - 6, side * 2 + 2, 6);
    ctx.fillStyle = ABYSS;
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      ctx.beginPath();
      ctx.arc((k / 3.4) * side, rim - 3, 1.3, 0, TAU);
      ctx.fill();
    }

    // The eye, in a plate on the front
    const ey = rim - 13;
    ctx.fillStyle = WARLOCK_BAND;
    ctx.beginPath();
    ctx.moveTo(-11, rim - 5);
    ctx.lineTo(-9, ey - 6);
    ctx.lineTo(0, ey - 10);
    ctx.lineTo(9, ey - 6);
    ctx.lineTo(11, rim - 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const open = Math.sin(t * 0.9) > 0.97 ? 0.15 : 1;
    ctx.beginPath();
    ctx.moveTo(-7, ey);
    ctx.quadraticCurveTo(0, ey - 7 * open, 7, ey);
    ctx.quadraticCurveTo(0, ey + 7 * open, -7, ey);
    ctx.closePath();
    ctx.fillStyle = ABYSS_GLOW;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (open === 1) {
      const look = Math.sin(t * 0.7) * 2.5;
      ctx.fillStyle = ABYSS;
      ctx.beginPath();
      ctx.arc(look, ey, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = WARLOCK_LINE;
      ctx.beginPath();
      ctx.ellipse(look, ey, 0.9, 2.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

const WARLOCK_IRON = '#3a3048';
const WARLOCK_BAND = '#251d30';
const WARLOCK_TENTACLE = '#6a3a9a';
const WARLOCK_LINE = '#120a1a';

const CROSS = { x: 0, y: 0 }; // reused by crossing (read it straight away)

// Where segments p1-q1 and p2-q2 cross, or null. Crossings right at either
// end (a portal two tentacles share) don't count.
function crossing(p1, q1, p2, q2) {
  const rx = q1.x - p1.x;
  const ry = q1.y - p1.y;
  const sx = q2.x - p2.x;
  const sy = q2.y - p2.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qpx = p2.x - p1.x;
  const qpy = p2.y - p1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  const edge = 0.04;
  if (t <= edge || t >= 1 - edge || u <= edge || u >= 1 - edge) return null;
  CROSS.x = p1.x + rx * t;
  CROSS.y = p1.y + ry * t;
  return CROSS;
}

// ---- Puppeteer ---------------------------------------------------------------------

const PUPPET_EVERY = 3; // an enemy's wall bounces per portal

export class Puppeteer extends TomeTransformation {
  static id = 'puppeteer';
  static displayName = 'Puppeteer';
  static description = `Every ${PUPPET_EVERY}rd time an enemy bounces off a wall, a portal tears open where they hit it, with a tentacle reaching out of it to your last portal.`;

  constructor(weapon) {
    super(weapon);
    this.every = PUPPET_EVERY; // an enemy's bounces per portal
    this.bounces = new Map(); // enemy ball -> its bounces since its last portal
  }

  onOtherWallBounce(ball, sim) {
    if (!ball.alive) return;
    const count = (this.bounces.get(ball) ?? 0) + 1;
    if (count < this.every) {
      this.bounces.set(ball, count);
      return;
    }
    this.bounces.set(ball, 0);
    const { weapon } = this;
    if (weapon.openPortal(weapon.wallPortalAt(ball.pos, sim.arena), sim)) this.emit(sim, 'puppet', { pos: ball.pos });
  }

  // A marionette's wooden control bar hanging above, swaying, its strings
  // tied to the ball.
  drawOver(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const time = this.weapon.time;
    const tilt = 0.18 * Math.sin(time * 2.2);
    const cy = -r - 26;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    // The bar's string ends, before turning: both ends of the long bar and the front of the short one
    const ends = [[-20, 0], [20, 0], [0, 9]];
    const ties = [-Math.PI / 2 - 0.95, -Math.PI / 2 + 0.95, -Math.PI / 2];
    ctx.strokeStyle = 'rgba(235, 235, 245, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < ends.length; i++) {
      const [ex, ey] = ends[i];
      ctx.moveTo(ex * cos - ey * sin, cy + ex * sin + ey * cos);
      ctx.lineTo(Math.cos(ties[i]) * r, Math.sin(ties[i]) * r);
    }
    ctx.stroke();
    ctx.translate(0, cy);
    ctx.rotate(tilt);
    ctx.fillStyle = '#9a6a3a';
    ctx.strokeStyle = '#4a2f16';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-23, -2.5, 46, 5);
    ctx.strokeRect(-23, -2.5, 46, 5);
    ctx.fillRect(-2.5, -11, 5, 22);
    ctx.strokeRect(-2.5, -11, 5, 22);
    ctx.fillStyle = '#4a2f16';
    for (const [ex, ey] of ends) {
      ctx.beginPath();
      ctx.arc(ex, ey, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Ensnarer ----------------------------------------------------------------------

const DETONATE = '#c6ff4a';
const DETONATE_SHARE = 4; // a burst hits for this many lashes' damage
const DETONATE_EVERY = 2.5; // s before the same portal can burst again

export class Ensnarer extends TomeTransformation {
  static id = 'ensnarer';
  static displayName = 'Ensnarer';
  static description = `An enemy that comes near one of your portals sets it off: a burst blasts out of it, hitting everyone around it for ${DETONATE_SHARE} times a lash's damage and throwing them off the wall. The portal stays open, and can burst again after ${DETONATE_EVERY}s.`;

  constructor(weapon) {
    super(weapon);
    this.armTime = 0.4; // s a portal must be open before it can go off
    this.every = DETONATE_EVERY;
    this.reach = 75; // px from the portal's centre an enemy's edge must come within to set it off
    this.blastRadius = 150; // px, everyone this close to the portal (to their edge) is hit
    this.blast = { x: 0, y: 0, radius: 0, age: Infinity }; // the last blast, for drawing
    this.blastTime = 0.35; // s its shockwave shows for (drawing only)
  }

  onUpdate(dt, sim) {
    this.blast.age += dt;
    if (sim.over) return;
    const { weapon, owner } = this;
    const { portals } = weapon;
    if (portals.length === 0) return;
    const reach = this.reach * owner.size;
    for (const portal of portals) {
      if (portal.burstLeft > 0) portal.burstLeft -= dt;
      if (portal.age < this.armTime || portal.burstLeft > 0) continue;
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner) continue;
        if (distance(enemy.pos, portal) >= enemy.radius + reach) continue;
        this.detonate(portal, sim);
        break;
      }
      if (sim.over) return;
    }
  }

  detonate(portal, sim) {
    const { weapon, owner, blast } = this;
    portal.burstLeft = this.every;
    blast.x = portal.x;
    blast.y = portal.y;
    blast.radius = this.blastRadius * owner.size;
    blast.age = 0;
    this.emit(sim, 'detonate', { pos: portal, shake: 5, burst: { color: DETONATE, count: 22, speed: 280, life: 0.45, size: 3 } });
    const { radius } = blast;
    const damage = weapon.damage * DETONATE_SHARE;
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive) continue;
      if (distance(enemy.pos, portal) >= enemy.radius + radius) continue;
      // Thrown off the wall, along the portal's normal.
      const speed = enemy.speed * CONFIG.combat.knockback;
      enemy.vel.x = portal.nx * speed;
      enemy.vel.y = portal.ny * speed;
      sim.applySecondaryHit(owner, enemy, damage, { reason: 'detonate', color: DETONATE });
      if (sim.over) return;
    }
  }

  drawOver(ctx) {
    this.drawNet(ctx);
    this.drawBlast(ctx);
  }

  // A fisherman's net slung over the top of the head, down to the brow: a
  // rope mesh bulging a little past the ball, a hem cord weighted with
  // glowing beads.
  drawNet(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const hem = -r * 0.5;
    const half = Math.sqrt(r * r - hem * hem) + 1.5;
    // The mesh, inside a cap a little bigger than the ball and above the hem
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-half, hem);
    ctx.bezierCurveTo(-r - 4, -r * 0.9, -r * 0.5, -r - 5, 0, -r - 5);
    ctx.bezierCurveTo(r * 0.5, -r - 5, r + 4, -r * 0.9, half, hem);
    ctx.quadraticCurveTo(0, hem + 6, -half, hem);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60, 48, 24, 0.25)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = '#c4b075';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let k = -2 * r; k <= 2 * r; k += 8) {
      ctx.moveTo(k - r, -r - 6);
      ctx.lineTo(k + r, r);
      ctx.moveTo(k + r, -r - 6);
      ctx.lineTo(k - r, r);
    }
    ctx.stroke();
    // Knots where the ropes cross
    ctx.fillStyle = '#8a7640';
    for (let kx = -r; kx <= r; kx += 8) {
      for (let ky = -r - 4; ky <= hem; ky += 8) {
        const ox = ((Math.round((ky + r) / 8) % 2) * 4) | 0;
        ctx.fillRect(kx + ox - 1, ky - 1, 2, 2);
      }
    }
    ctx.restore();
    // The hem's cord, sagging a little, and its beads
    ctx.strokeStyle = '#6b5a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half, hem);
    ctx.quadraticCurveTo(0, hem + 6, half, hem);
    ctx.stroke();
    ctx.fillStyle = DETONATE;
    ctx.strokeStyle = '#4a5a10';
    ctx.lineWidth = 1;
    for (const k of [-0.75, -0.25, 0.25, 0.75]) {
      ctx.beginPath();
      ctx.arc(k * half, hem + 3 * (1 - k * k) + 3, 2.4, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // A shockwave ring racing out to the blast's edge.
  drawBlast(ctx) {
    const { x, y, radius, age } = this.blast;
    if (age >= this.blastTime) return;
    const t = age / this.blastTime;
    ctx.save();
    ctx.globalAlpha = 0.25 * (1 - t);
    ctx.fillStyle = DETONATE;
    ctx.beginPath();
    ctx.arc(x, y, radius * t, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = DETONATE;
    ctx.lineWidth = 4 * (1 - t) + 1;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Satanist ----------------------------------------------------------------------

const PENTAGRAM = '#ff2a2a';
const PENTAGRAM_DAMAGE = 14;
const PENTAGRAM_EVERY = 10; // s

export class Satanist extends TomeTransformation {
  static id = 'satanist';
  static displayName = 'Satanist';
  static description = `Every ${PENTAGRAM_EVERY}s, a huge red pentagram is drawn across the arena. A moment later it burns: anyone on its lines takes ${PENTAGRAM_DAMAGE} damage.`;

  constructor(weapon) {
    super(weapon);
    this.every = PENTAGRAM_EVERY;
    this.warning = 1.2; // s the pentagram shows before it burns
    this.damage = PENTAGRAM_DAMAGE;
    this.lineWidth = 9; // px, half-width of its lines' hitbox
    this.span = 0.42; // its radius, as a share of the arena's shorter side
    this.flash = 0.6; // s it glows after burning (drawing only)

    this.nextLeft = 6; // s until the next one is drawn
    this.warnLeft = 0; // s; above 0 while drawn and about to burn
    this.flashLeft = 0;
    this.rotation = -Math.PI / 2; // turns a little every time, so the lines land somewhere new
    this.center = { x: 0, y: 0 };
    this.radius = 0;
    this.points = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  }

  onUpdate(dt, sim) {
    if (this.flashLeft > 0) this.flashLeft -= dt;
    if (sim.over) return;
    if (this.warnLeft > 0) {
      this.warnLeft -= dt;
      if (this.warnLeft <= 0) this.burn(sim);
      return;
    }
    this.nextLeft -= dt;
    if (this.nextLeft > 0) return;
    this.nextLeft = this.every;
    this.inscribe(sim);
  }

  // Lays the pentagram out over the arena and starts the warning.
  inscribe(sim) {
    const { width, height } = sim.arena;
    this.center.x = width / 2;
    this.center.y = height / 2;
    this.radius = Math.min(width, height) * this.span;
    this.rotation += 0.9;
    for (let i = 0; i < 5; i++) {
      const a = this.rotation + (i * TAU) / 5;
      this.points[i].x = this.center.x + Math.cos(a) * this.radius;
      this.points[i].y = this.center.y + Math.sin(a) * this.radius;
    }
    this.warnLeft = this.warning;
    this.emit(sim, 'pentagram-warn', { pos: this.center });
  }

  // Everyone on a line of the star or on the circle takes the damage.
  burn(sim) {
    const { owner } = this;
    this.flashLeft = this.flash;
    this.emit(sim, 'pentagram', { pos: this.center, shake: 8 });
    const width = this.lineWidth * owner.size;
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive || !this.onLines(enemy, width)) continue;
      sim.applySecondaryHit(owner, enemy, this.damage, { reason: 'pentagram', color: PENTAGRAM });
      if (sim.over) return;
    }
  }

  onLines(ball, width) {
    const ring = distance(ball.pos, this.center) - this.radius;
    if (Math.abs(ring) < ball.radius + width) return true;
    // The star joins every second point.
    for (let i = 0; i < 5; i++) if (touchesSegment(ball, this.points[i], this.points[(i + 2) % 5], width)) return true;
    return false;
  }

  drawUnder(ctx) {
    this.drawTail(ctx);
    this.drawPentagram(ctx);
  }

  // A devil's tail curling out from behind, swishing, with a spade at its tip.
  drawTail(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const swish = Math.sin(this.weapon.time * 3);
    const tip = { x: -r - 20, y: r + 4 + 8 * swish };
    ctx.strokeStyle = '#b3141b';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.5);
    ctx.bezierCurveTo(-r * 0.6, r + 18, -r - 4, r - 12 - 10 * swish, tip.x, tip.y);
    ctx.stroke();
    // The spade, pointing on along the tail
    const angle = Math.atan2(tip.y - (r - 12 - 10 * swish), tip.x + r + 4);
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#b3141b';
    ctx.strokeStyle = '#4a0508';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(1, -6);
    ctx.lineTo(10, 0);
    ctx.lineTo(1, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // A pair of curved red horns.
  drawOver(ctx) {
    const r = costumeFrame(ctx, this.owner);
    ctx.fillStyle = '#b3141b';
    ctx.strokeStyle = '#4a0508';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const inner = -Math.PI / 2 + s * 0.28;
      const outer = -Math.PI / 2 + s * 0.78;
      const tip = { x: s * r * 0.95, y: -r - 17 };
      ctx.beginPath();
      ctx.moveTo(Math.cos(inner) * (r - 2), Math.sin(inner) * (r - 2));
      ctx.quadraticCurveTo(s * r * 0.35, -r - 14, tip.x, tip.y);
      ctx.quadraticCurveTo(s * r * 0.95, -r * 0.85, Math.cos(outer) * (r - 2), Math.sin(outer) * (r - 2));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Faint and flickering while it's about to burn, then a bright flash fading out.
  drawPentagram(ctx) {
    const warning = this.warnLeft > 0;
    if (!warning && this.flashLeft <= 0) return;
    const width = this.lineWidth * this.owner.size;
    ctx.save();
    ctx.strokeStyle = PENTAGRAM;
    ctx.lineJoin = 'round';
    if (warning) {
      const t = 1 - this.warnLeft / this.warning;
      ctx.globalAlpha = 0.2 + 0.35 * t + 0.1 * Math.sin(t * 40);
      ctx.lineWidth = 2;
    } else {
      ctx.globalAlpha = this.flashLeft / this.flash;
      ctx.lineWidth = width * 2;
      ctx.shadowColor = PENTAGRAM;
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(this.center.x, this.center.y, this.radius, 0, TAU);
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i <= 5; i++) {
      const p = this.points[(i * 2) % 5];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Priest ------------------------------------------------------------------------

const HEAL_SHARE = 0.25; // of a lash's damage, healed every lash's worth of time spent in a beam

export class Priest extends TomeTransformation {
  static id = 'priest';
  static displayName = 'Priest';
  static description = `Your tome turns holy and your tentacles become beams of light. While you're in one of your beams, it heals you for ${HEAL_SHARE * 100}% of a lash's damage every lash.`;

  constructor(weapon) {
    super(weapon);
    this.tickLeft = 0;
  }

  apply() {
    this.weapon.holy = true;
  }

  onUpdate(dt, sim) {
    const { weapon, owner } = this;
    this.tickLeft -= dt;
    if (this.tickLeft > 0) return;
    this.tickLeft += weapon.tentacleTick;
    if (sim.over || owner.hp >= owner.maxHp) return;
    const width = weapon.tentacleWidth * owner.size;
    for (const tentacle of weapon.tentacles) {
      if (!touchesSegment(owner, tentacle.from, weapon.tipOf(tentacle), width)) continue;
      if (owner.heal(weapon.damage * HEAL_SHARE) > 0) this.emit(sim, 'bless', { burst: { color: '#ffe680', count: 4, speed: 90, life: 0.4, size: 2 } });
      return;
    }
  }

  // A golden halo floating above the head, glowing and bobbing.
  drawOver(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const time = this.weapon.time;
    const y = -r - 11 + 2 * Math.sin(time * 2.5);
    ctx.strokeStyle = '#ffd84a';
    ctx.shadowColor = '#fff3b0';
    ctx.shadowBlur = 10 + 4 * Math.sin(time * 4);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, y, r * 0.62, 6, 0, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fffbe8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Bestial Worshipper ------------------------------------------------------------

const CLAW = '#ff6b5a';
const CLAW_DAMAGE = 2.5;
const CLAW_VULNERABLE = 0.1; // more damage taken, per swipe
const CLAW_VULNERABLE_CAP = 0.3;

export class BestialWorshipper extends TomeTransformation {
  static id = 'bestial-worshipper';
  static displayName = 'Bestial Worshipper';
  static description = `When an enemy is close, maul them with quick feral swipes for ${CLAW_DAMAGE} damage each. Every swipe leaves them ${CLAW_VULNERABLE * 100}% more vulnerable to damage, up to ${CLAW_VULNERABLE_CAP * 100}%, for 2.5s.`;

  constructor(weapon) {
    super(weapon);
    this.range = 105; // px, centre to centre
    this.cooldown = 0.5; // s between swipes
    this.cooldownLeft = 0;
    this.vulnerableTime = 2.5; // s
    this.swipe = { angle: 0, age: Infinity, side: 1 }; // the last swipe, for drawing
    this.swipeTime = 0.18; // s a swipe shows for (drawing only)
  }

  onUpdate(dt, sim) {
    this.swipe.age += dt;
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
    if (this.cooldownLeft > 0 || sim.over) return;
    const enemy = this.enemyWithin(sim, this.range);
    if (!enemy) return;
    this.cooldownLeft = this.cooldown;
    const { owner } = this;
    this.swipe.angle = Math.atan2(enemy.pos.y - owner.pos.y, enemy.pos.x - owner.pos.x);
    this.swipe.age = 0;
    this.swipe.side = -this.swipe.side;
    this.emit(sim, 'claw', { pos: enemy.pos, burst: { color: CLAW, count: 6, speed: 180, life: 0.25, size: 2 } });
    if (sim.applySecondaryHit(owner, enemy, CLAW_DAMAGE, { reason: 'claw', color: CLAW, scatters: false }) > 0 && enemy.alive) {
      Vulnerable.add(enemy, { source: owner, step: CLAW_VULNERABLE, cap: CLAW_VULNERABLE_CAP, duration: this.vulnerableTime }, sim);
    }
  }

  drawOver(ctx) {
    this.drawEars(ctx);
    this.drawSwipe(ctx);
  }

  // A wolf's pointed furry ears, flicking now and then, and three stripes
  // of red war paint across one cheek.
  drawEars(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const time = this.weapon.time;
    ctx.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const flick = Math.max(0, Math.sin(time * 1.7 + s)) ** 8 * 0.35; // a sharp twitch, now and then
      const a = -Math.PI / 2 + s * 0.3;
      const b = -Math.PI / 2 + s * 0.95;
      ctx.save();
      ctx.rotate(s * flick);
      ctx.fillStyle = '#6b4a32';
      ctx.strokeStyle = '#2e1d10';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      ctx.lineTo(s * r * 0.8, -r - 16);
      ctx.lineTo(Math.cos(b) * (r - 3), Math.sin(b) * (r - 3));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d98c7a';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a + s * 0.12) * (r - 4), Math.sin(a + s * 0.12) * (r - 4));
      ctx.lineTo(s * r * 0.74, -r - 9);
      ctx.lineTo(Math.cos(b - s * 0.12) * (r - 4), Math.sin(b - s * 0.12) * (r - 4));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = CLAW;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const y = r * 0.3 + k * 6;
      ctx.moveTo(-r * 0.78, y - 3);
      ctx.lineTo(-r * 0.52, y + 3);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Three claw marks raking across towards the enemy.
  drawSwipe(ctx) {
    const { angle, age, side } = this.swipe;
    if (age >= this.swipeTime) return;
    const { owner } = this;
    const t = age / this.swipeTime;
    const reach = owner.radius + 34 * owner.size;
    ctx.save();
    ctx.translate(owner.pos.x, owner.pos.y);
    ctx.rotate(angle);
    ctx.strokeStyle = CLAW;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3 * owner.size;
    ctx.globalAlpha = 1 - t;
    for (let k = -1; k <= 1; k++) {
      const r = reach + k * 8 * owner.size;
      const start = side * (-0.9 + 1.4 * t) - 0.35;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, start + 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- Arsonist ----------------------------------------------------------------------

const LAVA = '#ff5a1f';
const LAVA_CORE = '#ffc23f';
const LAVA_CRUST = '#5a1a0a';
const LAVA_DAMAGE = 1.5; // per tick
const LAVA_TICK = 0.5; // s

export class Arsonist extends TomeTransformation {
  static id = 'arsonist';
  static displayName = 'Arsonist';
  static description = `A pool of lava runs along the whole bottom of the arena. Enemies in it take ${LAVA_DAMAGE} damage every ${LAVA_TICK}s and are set burning, and keep burning for 2s after they climb out. It doesn't hurt you.`;

  constructor(weapon) {
    super(weapon);
    this.depth = 32; // px up from the floor
    this.damage = LAVA_DAMAGE;
    this.tick = LAVA_TICK;
    this.tickLeft = LAVA_TICK;
    this.burn = { duration: 2, damage: 1, tick: 0.5 };
    this.time = 0; // drawing only
  }

  // The pool's box in `arena`: { left, right, top, bottom }, wall to wall.
  pool(arena) {
    POOL.left = 0;
    POOL.right = arena.width;
    POOL.bottom = arena.height;
    POOL.top = arena.height - this.depth * this.owner.size;
    return POOL;
  }

  onUpdate(dt, sim) {
    this.time += dt;
    this.tickLeft -= dt;
    if (this.tickLeft > 0 || sim.over) return;
    this.tickLeft += this.tick;
    const { owner } = this;
    const { left, right, top } = this.pool(sim.arena);
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive) continue;
      const { y } = enemy.pos;
      if (y + enemy.radius <= top) continue;
      sim.dealDamage(owner, enemy, this.damage, { reason: 'lava', color: LAVA });
      if (sim.over) return;
      if (enemy.alive) enemy.addStatus(new Burning({ source: owner, ...this.burn }), sim);
    }
  }

  // A glowing pool with a dark crust along its edge and bubbles rising.
  drawUnder(ctx) {
    const arena = this.owner.arena;
    const { left, right, top, bottom } = this.pool(arena);
    const width = right - left;
    const depth = bottom - top;
    const t = this.time;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = LAVA;
    ctx.fillRect(left, top - 6, width, depth + 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = LAVA;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const x = left + (width * i) / steps;
      ctx.lineTo(x, top + 2.5 * Math.sin(t * 3 + i * 1.3));
    }
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LAVA_CRUST;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = LAVA_CORE;
    for (let i = 0; i < 9; i++) {
      const life = (t * 0.7 + i * 0.37) % 1;
      const x = left + width * ((i * 0.23 + 0.1) % 1);
      ctx.globalAlpha = 0.9 * (1 - life);
      ctx.beginPath();
      ctx.arc(x, bottom - depth * 0.2 - depth * 0.7 * life, 2 + 3 * life, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // A soot-smudged black beanie with a big lit match tucked into its fold.
  drawOver(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const t = this.time;
    const brim = -r * 0.5;
    const half = Math.sqrt(r * r - brim * brim) + 2;
    ctx.lineJoin = 'round';
    // The match, behind the fold: a stick, a red head and its flame
    const root = { x: r * 0.22, y: brim - 4 };
    const head = { x: r * 0.58, y: -r - 24 };
    const flicker = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
    drawFlame(ctx, head.x, head.y - 2, 13, 30 * flicker, -Math.PI / 2 + 0.1 * Math.sin(t * 5), 0.1 * Math.sin(t * 9));
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 5.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.strokeStyle = '#e8c48a';
    ctx.lineWidth = 3.8;
    ctx.stroke();
    ctx.fillStyle = '#c8231c';
    ctx.strokeStyle = '#5a0e0a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, 4.2, 5.6, Math.atan2(head.y - root.y, head.x - root.x) + Math.PI / 2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // The beanie's crown
    const crown = new Path2D();
    crown.moveTo(-half, brim);
    crown.bezierCurveTo(-r - 3, -r * 1.05, -r * 0.5, -r - 7, 0, -r - 7);
    crown.bezierCurveTo(r * 0.5, -r - 7, r + 3, -r * 1.05, half, brim);
    crown.closePath();
    ctx.fillStyle = '#2b2a2e';
    ctx.fill(crown);
    ctx.strokeStyle = '#0e0d10';
    ctx.lineWidth = 1.5;
    ctx.stroke(crown);
    // Knit ribs and soot smudges
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) {
      ctx.moveTo(k * r * 0.22, brim - 2);
      ctx.quadraticCurveTo(k * r * 0.2, -r * 0.9, k * r * 0.08, -r - 5);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.8, 6, 3.5, -0.4, 0, TAU);
    ctx.ellipse(r * 0.15, -r * 0.95, 4, 2.5, 0.3, 0, TAU);
    ctx.fill();
    // The folded-up cuff, with an ember glowing on it
    ctx.fillStyle = '#3c3b40';
    ctx.strokeStyle = '#0e0d10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-half, brim + 1);
    ctx.quadraticCurveTo(0, brim - 6, half, brim + 1);
    ctx.lineTo(half - 1, brim - 7);
    ctx.quadraticCurveTo(0, brim - 14, -half + 1, brim - 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = LAVA_CORE;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4);
    ctx.beginPath();
    ctx.arc(-r * 0.45, brim - 4.5, 1.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

const POOL = { left: 0, right: 0, top: 0, bottom: 0 }; // reused by Arsonist.pool (read it straight away)

// ---- Witch -------------------------------------------------------------------------

const FEATHER = '#1b1726';
const FEATHER_SHEEN = '#5a4a85';
const FEATHER_RIM = '#c9b8f0';
const BEAK = '#ffb02e';
const PECK_DAMAGE = 1.8;

export class Witch extends TomeTransformation {
  static id = 'witch';
  static displayName = 'Witch';
  static description = `A raven familiar circles you and swoops at the nearest enemy every ${1.4}s, pecking for ${PECK_DAMAGE} damage. Weapons and shields can swat it away, sending it back to you to rest a little longer.`;

  constructor(weapon) {
    super(weapon);
    this.cooldown = 1.4; // s it rests by you between swoops
    this.swatCooldown = 2.4; // s it rests after being swatted
    this.speed = 420; // px/s while swooping
    this.returnSpeed = 340; // px/s flying back
    this.orbit = 58; // px from the ball's centre while resting
    this.radius = 9; // px, its hitbox
    this.damage = PECK_DAMAGE;
    this.swoopTime = 1.6; // s it gives up a swoop after

    const { pos } = weapon.owner;
    this.bird = {
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      mode: 'rest', // 'rest' (circling you), 'swoop' (at `target`) or 'return'
      target: null,
      timeLeft: 1, // s left resting, or swooping
      angle: 0, // where it is around you while resting
      flap: 0, // drawing only
    };
  }

  onUpdate(dt, sim) {
    const { bird, owner } = this;
    const size = owner.size;
    bird.flap += dt * (bird.mode === 'rest' ? 10 : 16);
    bird.timeLeft -= dt;

    if (bird.mode === 'rest') {
      bird.angle += dt * 3;
      this.flyTowards(owner.pos.x + Math.cos(bird.angle) * this.orbit * size, owner.pos.y + Math.sin(bird.angle) * this.orbit * size, this.returnSpeed * size, 8, dt);
      if (bird.timeLeft <= 0 && !sim.over) {
        const enemy = this.nearestEnemy(sim);
        if (enemy) {
          bird.mode = 'swoop';
          bird.target = enemy;
          bird.timeLeft = this.swoopTime;
          this.emit(sim, 'caw', { pos: bird });
        }
      }
    } else if (bird.mode === 'swoop') {
      const { target } = bird;
      if (!target.alive || bird.timeLeft <= 0 || sim.over) {
        this.goHome(this.cooldown);
      } else {
        const fromX = bird.x;
        const fromY = bird.y;
        this.flyTowards(target.pos.x, target.pos.y, this.speed * size, 7, dt);
        this.strike(fromX, fromY, sim);
      }
    } else {
      this.flyTowards(owner.pos.x, owner.pos.y, this.returnSpeed * size, 8, dt);
      if (hypot(bird.x - owner.pos.x, bird.y - owner.pos.y) < this.orbit * size) {
        bird.mode = 'rest';
        bird.angle = Math.atan2(bird.y - owner.pos.y, bird.x - owner.pos.x);
      }
    }
  }

  // Steers the bird towards (x, y) at `speed`, turning at `turn` per second, and moves it.
  flyTowards(x, y, speed, turn, dt) {
    const { bird } = this;
    const dx = x - bird.x;
    const dy = y - bird.y;
    const len = hypot(dx, dy) || 1;
    const k = Math.min(1, dt * turn);
    bird.vx += ((dx / len) * speed - bird.vx) * k;
    bird.vy += ((dy / len) * speed - bird.vy) * k;
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;
  }

  // Swooping: blocked by the target's guard (swatted), or pecks it on touching it.
  strike(fromX, fromY, sim) {
    const { bird, owner, weapon } = this;
    const enemy = bird.target;
    const radius = this.radius * owner.size;
    FROM.x = fromX;
    FROM.y = fromY;
    TO.x = bird.x;
    TO.y = bird.y;
    if (distance(TO, enemy.pos) < Math.max(enemy.weapon.guardReach, enemy.radius) + radius) {
      const blocked = projectileBlockedBy(weapon, FROM, TO, enemy, radius, false);
      if (blocked) {
        this.emit(sim, 'shoo', { pos: blocked.point, burst: { color: FEATHER_SHEEN, count: 8, speed: 160, life: 0.35, size: 2.2 } });
        // Knocked away from the enemy.
        const dx = bird.x - enemy.pos.x;
        const dy = bird.y - enemy.pos.y;
        const len = hypot(dx, dy) || 1;
        bird.vx = (dx / len) * this.speed * owner.size;
        bird.vy = (dy / len) * this.speed * owner.size;
        this.goHome(this.swatCooldown);
        return;
      }
    }
    if (distance(TO, enemy.pos) >= enemy.radius + radius) return;
    this.goHome(this.cooldown);
    this.emit(sim, 'peck', { pos: bird, burst: { color: FEATHER_SHEEN, count: 5, speed: 120, life: 0.3, size: 2 } });
    sim.applySecondaryHit(owner, enemy, this.damage, { reason: 'peck', color: BEAK, point: { x: bird.x, y: bird.y } });
  }

  goHome(rest) {
    const { bird } = this;
    bird.mode = 'return';
    bird.target = null;
    bird.timeLeft = rest;
  }

  drawOver(ctx) {
    this.drawHat(ctx);
    this.drawRaven(ctx);
  }

  // A tall, crooked witch's hat, tipped to one side, with a buckled band.
  drawHat(ctx) {
    const r = costumeFrame(ctx, this.owner);
    const droop = 0.08 * Math.sin(this.weapon.time * 2);
    ctx.translate(0, -r * 0.78);
    ctx.rotate(-0.18);
    ctx.fillStyle = '#2b1a3d';
    ctx.strokeStyle = '#120a1c';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    // Brim
    ctx.beginPath();
    ctx.ellipse(0, 0, r + 10, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Crown, bent over near the tip
    const w = r * 0.58;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(-w * 0.5, -22, -3, -34);
    ctx.quadraticCurveTo(4 + 6 * droop, -44, 18 + 20 * droop, -38 + 10 * droop);
    ctx.quadraticCurveTo(8, -36, 6, -28);
    ctx.quadraticCurveTo(w * 0.6, -14, w, 0);
    ctx.quadraticCurveTo(0, 4, -w, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Band and buckle
    ctx.fillStyle = '#6b3fa0';
    ctx.beginPath();
    ctx.moveTo(-w + 1, -1);
    ctx.quadraticCurveTo(0, 3, w - 1, -1);
    ctx.lineTo(w - 3, -7);
    ctx.quadraticCurveTo(0, -3, -w + 3, -7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = BEAK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-3.5, -6.5, 7, 6);
    ctx.restore();
  }

  // A black raven with flapping wings and a yellow beak, facing where it flies.
  drawRaven(ctx) {
    const { bird, owner } = this;
    const size = owner.size;
    const heading = Math.atan2(bird.vy, bird.vx);
    const wing = Math.sin(bird.flap);
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(heading);
    ctx.scale(size, size);
    // Its outline first, wide and pale, so it shows on the dark floor
    const body = new Path2D();
    for (const side of [-1, 1]) {
      body.moveTo(2, 0);
      body.quadraticCurveTo(-2, side * (10 + 6 * wing), -10, side * (13 + 5 * wing));
      body.lineTo(-5, side * 2);
      body.closePath();
    }
    body.moveTo(-6, 0);
    body.lineTo(-14, -4);
    body.lineTo(-14, 4);
    body.closePath();
    body.ellipse(-1, 0, 8, 4.5, 0, 0, TAU);
    body.moveTo(10.8, 0);
    body.arc(7, 0, 3.8, 0, TAU);
    ctx.strokeStyle = FEATHER_RIM;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.8;
    ctx.stroke(body);
    ctx.globalAlpha = 1;
    // Wings
    ctx.fillStyle = FEATHER_SHEEN;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(-2, side * (10 + 6 * wing), -10, side * (13 + 5 * wing));
      ctx.lineTo(-5, side * 2);
      ctx.closePath();
      ctx.fill();
    }
    // Tail, body, head
    ctx.fillStyle = FEATHER;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-14, -4);
    ctx.lineTo(-14, 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-1, 0, 8, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7, 0, 3.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = BEAK;
    ctx.beginPath();
    ctx.moveTo(10, -1.5);
    ctx.lineTo(15, 0);
    ctx.lineTo(10, 1.5);
    ctx.closePath();
    ctx.fill();
    // A glinting yellow eye
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.arc(8, -1.4, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(8.3, -1.4, 0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

const FROM = { x: 0, y: 0 }; // reused by Witch.strike
const TO = { x: 0, y: 0 };
