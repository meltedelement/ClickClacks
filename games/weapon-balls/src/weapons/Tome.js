import { Weapon } from './Weapon.js';
import { TAU, closestPointOnSegment, distance, hypot } from '../sim/math.js';

// The colours: eldritch, or holy for Priest (see `holy`).
export const UNHOLY = {
  void: '#1a0f2b', // inside a portal
  rim: '#7dff9a', // a portal's rim, the sigil, a lash's hit
  flesh: '#3d2252',
  light: '#6b3f86', // a tentacle's core
  sucker: '#c9a3e0',
  cover: '#3b2350',
  edge: '#1c0f28', // the cover's edge and spine, a tentacle's outline
  pages: '#e8dcc0',
};
export const HOLY = {
  void: '#fffbe8',
  rim: '#ffd84a',
  flesh: '#fff3b0',
  light: '#ffffff',
  sucker: '#ffe680',
  cover: '#f4f1ea',
  edge: '#b8962e',
  pages: '#fffdf5',
};
const OPEN_TIME = 0.2; // s a portal takes to open fully (drawing only)
const CLOSE_TIME = 0.35; // s a portal takes to shut at the end of its life (drawing only)
const TENTACLE_POINTS = 18; // points along a tentacle's drawn curve
const GRAB_TIME = 0.3; // s a stretched tentacle takes to spring back (drawing only)

// An eldritch tome. The ball is a little smaller and quicker than the others,
// and holds a book instead of a weapon: it has no blades at all (`blades` is
// 0), so nothing of it spins, hits, parries or blocks. The tentacles are its
// only weapon.
//
// Whenever the ball bounces off a wall it tears open a portal there. When the
// next portal opens, a tentacle reaches out of it to the one before, and stays
// stretched across the arena between the two until either closes. An enemy
// touching a tentacle takes `damage` every `tentacleTick` (a secondary hit,
// see Simulation.applySecondaryHit: upgrades' damage multipliers, crits,
// Armor and Lifesteal apply, but no knockback). Every lash that lands grows
// `damage`, and the ball's speed and max HP with it (the HP gained is
// healed). At most `maxPortals` are open at once: a new one past that
// closes the oldest, and its tentacles go with it. A portal also closes on its
// own after `portalLife`.
//
// Portals sit on the walls, in arena coordinates. Their size and the
// tentacles' thickness go with `owner.size` as they're used, so a royale needs
// no onGrow.
export class Tome extends Weapon {
  static id = 'tome';
  static displayName = 'Tome';
  static hue = 140;

  constructor(owner) {
    super(owner);
    // The ball: smaller and quicker than the rest.
    owner.radius *= 0.85;
    owner.speed *= 1.15;

    // No blades: the book is only held.
    this.blades = 0;
    this.damage = 1.3; // per tentacle lash

    // Scaling, per tentacle lash that lands
    this.damagePerHit = 0.035;
    this.speedPerHit = 2; // px/s
    this.maxSpeed = owner.speed * 1.6; // speed gained from hits stops here
    this.hpPerHit = 0.6; // max HP, healed too

    // Portals and tentacles
    this.maxPortals = 4;
    this.portalLife = 9; // s
    this.portalCooldown = 0.35; // s after one opens before a bounce opens another
    this.portalSpacing = 70; // px: a bounce this close to an open portal opens none
    this.portalRadius = 20; // px along the wall (the drawing only)
    this.tentacleWidth = 8; // px, hitbox half-width
    this.tentacleStretch = 0; // px further a tentacle reaches out to grab an enemy passing by (Stretchy Tentacles)
    this.tentacleTick = 0.32; // s between a tentacle's lashes
    this.tentacleReach = 0.25; // s a tentacle takes to cross from portal to portal; it lashes once across

    this.portals = []; // see newPortal, oldest first
    this.tentacles = []; // see newTentacle
    this.portalCooldownLeft = 0;
    this.time = 0; // s, for drawing
    this.holy = false; // Priest: beams of light instead of tentacles (drawing only)
  }

  // A portal on the wall at (x, y), opening towards (nx, ny), the inward normal.
  newPortal(x, y, nx, ny) {
    // burstLeft: s until Ensnarer's burst can go off here again.
    return { x, y, nx, ny, age: 0, life: this.portalLife, open: true, burstLeft: 0 };
  }

  // A tentacle from portal `from` (the new one, where it comes out) to `to`.
  // `reach` is how far across it has got, 0 to 1; `tickLeft` the time to its next lash.
  // The grab fields are for drawing a stretch (Stretchy Tentacles): where
  // along it (`grabT`, 0 to 1) it last bent out, by how much (`grabX`,
  // `grabY`), and when (`grabAt`).
  newTentacle(from, to) {
    return { from, to, reach: 0, tickLeft: 0, phase: this.time * 7, grabT: 0, grabX: 0, grabY: 0, grabAt: -Infinity }; // phase: drawing only, so no Math.random
  }

  // A lash landed: everything grows.
  grow() {
    const { owner } = this;
    this.damage += this.damagePerHit;
    owner.speed = Math.min(this.maxSpeed, owner.speed + this.speedPerHit);
    owner.maxHp += this.hpPerHit;
    owner.heal(this.hpPerHit);
  }

  // The ball bounced off a wall: a portal there, and a tentacle back to the last one.
  onWallBounce(sim) {
    if (sim.over || this.portalCooldownLeft > 0) return;
    if (this.openPortal(this.wallPortalAt(this.owner.pos, sim.arena), sim)) this.portalCooldownLeft = this.portalCooldown;
  }

  // A new portal on the wall nearest `pos` (the wall a ball there just hit; a
  // corner counts as either), not yet open.
  wallPortalAt(pos, arena) {
    const { width, height } = arena;
    const { x, y } = pos;
    const left = x;
    const right = width - x;
    const top = y;
    const bottom = height - y;
    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) return this.newPortal(0, y, 1, 0);
    if (nearest === right) return this.newPortal(width, y, -1, 0);
    if (nearest === top) return this.newPortal(x, 0, 0, 1);
    return this.newPortal(x, height, 0, -1);
  }

  // Opens `portal` (from wallPortalAt), with a tentacle from it back to the
  // last one, unless it's too close to one already open. Past `maxPortals`
  // the oldest closes. Returns true if it opened.
  openPortal(portal, sim) {
    const { owner } = this;
    const spacing = this.portalSpacing * owner.size;
    for (const other of this.portals) if (distance(other, portal) < spacing) return false;

    const last = this.portals[this.portals.length - 1];
    this.portals.push(portal);
    if (this.portals.length > this.maxPortals) this.closePortal(this.portals[0]);
    const colors = this.holy ? HOLY : UNHOLY;
    sim.onEvent('ability', { ball: owner, ability: null, phase: 'rift', pos: portal, burst: { color: colors.rim, count: 14, speed: 160, life: 0.4, size: 2.2 } });
    if (last) {
      this.tentacles.push(this.newTentacle(portal, last));
      sim.onEvent('ability', { ball: owner, ability: null, phase: 'tentacle', pos: portal, shake: 2, burst: { color: colors.light, count: 10, speed: 120, life: 0.35, size: 2.5 } });
    }
    return true;
  }

  // Shuts `portal`, and every tentacle stretched to or from it.
  closePortal(portal) {
    portal.open = false;
    this.portals = this.portals.filter((p) => p !== portal);
    this.tentacles = this.tentacles.filter((t) => t.from !== portal && t.to !== portal);
  }

  update(dt, sim) {
    super.update(dt, sim);
    this.time += dt;
    if (this.portalCooldownLeft > 0) this.portalCooldownLeft -= dt;
    if (this.portals.length === 0) return;
    for (const portal of this.portals) portal.age += dt;
    if (this.portals[0].age >= this.portals[0].life) {
      for (const portal of [...this.portals]) if (portal.age >= portal.life) this.closePortal(portal);
    }
    if (sim.over) return;
    for (const tentacle of this.tentacles) {
      if (tentacle.reach < 1) tentacle.reach = Math.min(1, tentacle.reach + dt / this.tentacleReach);
      tentacle.tickLeft -= dt;
      if (tentacle.tickLeft > 0) continue;
      tentacle.tickLeft += this.tentacleTick;
      this.lash(tentacle, sim);
      if (sim.over) return;
    }
  }

  // Where a tentacle's tip is: `reach` of the way from its portal to the other.
  tipOf(tentacle) {
    const { from, to, reach } = tentacle;
    return { x: from.x + (to.x - from.x) * reach, y: from.y + (to.y - from.y) * reach };
  }

  // Every enemy touching the tentacle (as far as it has reached) takes a hit.
  lash(tentacle, sim) {
    const { owner } = this;
    const tip = this.tipOf(tentacle);
    const width = this.tentacleWidth * owner.size;
    const stretch = this.tentacleStretch * owner.size;
    const damage = this.damage;
    // A copy: a knockout changes aliveBalls.
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive) continue;
      const point = closestPointOnSegment(enemy.pos, tentacle.from, tip);
      const gap = distance(enemy.pos, point) - enemy.radius;
      if (gap >= width + stretch) continue;
      if (gap > width) this.stretchTo(tentacle, tip, point, enemy, gap - width * 0.5);
      if (sim.applySecondaryHit(owner, enemy, damage, { reason: 'tentacle', color: (this.holy ? HOLY : UNHOLY).rim, point }) > 0) this.grow();
      if (sim.over) return;
    }
  }

  // Remembers a stretch out to `enemy`, `by` px from `point` on the tentacle (drawing only).
  stretchTo(tentacle, tip, point, enemy, by) {
    const dx = enemy.pos.x - point.x;
    const dy = enemy.pos.y - point.y;
    const len = hypot(dx, dy) || 1;
    const along = hypot(tip.x - tentacle.from.x, tip.y - tentacle.from.y) || 1;
    tentacle.grabT = hypot(point.x - tentacle.from.x, point.y - tentacle.from.y) / along;
    tentacle.grabX = (dx / len) * by;
    tentacle.grabY = (dy / len) * by;
    tentacle.grabAt = this.time;
  }

  // ---- Drawing ------------------------------------------------------------------

  // No blades, so nothing to reach (see Weapon.bladeReach).
  get bladeReach() {
    return 0;
  }

  // The book, held against the ball's lower right, bobbing a little: bound in
  // dark leather, its pages showing at the edge and a green eye on the cover.
  // Drawn at size 1 under a canvas scaled to the ball (see Weapon.draw).
  draw(ctx) {
    const { owner } = this;
    const size = owner.size;
    const r = owner.radius / size;
    const bob = Math.sin(this.time * 3) * 1.5;
    ctx.save();
    ctx.translate(owner.pos.x, owner.pos.y);
    ctx.scale(size, size);
    ctx.translate(r * 0.62, r * 0.5 + bob);
    ctx.rotate(-0.18);
    const w = 18;
    const h = 22;
    const c = this.holy ? HOLY : UNHOLY;

    // Glow
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(this.time * 4);
    ctx.fillStyle = c.rim;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.85, h * 0.75, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Pages, then the cover over them, then the spine
    ctx.fillStyle = c.pages;
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1.5, w, h - 3);
    ctx.fillStyle = c.cover;
    ctx.fillRect(-w / 2, -h / 2, w - 2, h);
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -h / 2, w - 2, h);
    ctx.fillStyle = c.edge;
    ctx.fillRect(-w / 2, -h / 2, 3.5, h);

    const cx = 0.75;
    if (this.holy) {
      // A golden cross
      ctx.fillStyle = c.rim;
      ctx.fillRect(cx - 1.2, -7, 2.4, 14);
      ctx.fillRect(cx - 4.5, -3.5, 9, 2.4);
    } else {
      // An eye for a sigil
      ctx.strokeStyle = c.rim;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(cx, 0, 6, 3.6, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = c.rim;
      ctx.beginPath();
      ctx.ellipse(cx, 0, 1.5, 3, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // Portals and tentacles lie in the arena, under the balls.
  drawUnder(ctx) {
    if (this.portals.length === 0) return;
    const size = this.owner.size;
    for (const tentacle of this.tentacles) this.drawTentacle(ctx, tentacle, size);
    for (const portal of this.portals) this.drawPortal(ctx, portal, size);
  }

  // A rip in the wall: a dark oval along it with a glowing green rim and a
  // slow swirl inside, swelling open and shrinking shut.
  drawPortal(ctx, portal, size) {
    const opening = Math.min(1, portal.age / OPEN_TIME);
    const closing = Math.min(1, (portal.life - portal.age) / CLOSE_TIME);
    const k = Math.min(opening, closing);
    if (k <= 0) return;
    const along = this.portalRadius * size * k;
    const deep = this.portalRadius * 0.45 * size * k;
    const angle = Math.atan2(portal.nx, -portal.ny); // the wall's direction
    const c = this.holy ? HOLY : UNHOLY;
    ctx.save();
    ctx.translate(portal.x, portal.y);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.35 * k;
    ctx.fillStyle = c.rim;
    ctx.beginPath();
    ctx.ellipse(0, 0, along * 1.35, deep * 1.8, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.void;
    ctx.beginPath();
    ctx.ellipse(0, 0, along, deep, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = c.rim;
    ctx.lineWidth = 2 * size;
    ctx.stroke();
    // Swirl
    ctx.strokeStyle = this.holy ? 'rgba(255, 216, 74, 0.6)' : 'rgba(125, 255, 154, 0.55)';
    ctx.lineWidth = 1.2 * size;
    const spin = this.time * 3 + portal.x * 0.01 + portal.y * 0.01;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, along * (0.35 + 0.3 * i), deep * (0.35 + 0.3 * i), 0, spin + i * Math.PI, spin + i * Math.PI + 2.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A writhing tentacle from its portal to its tip: a dark outline, a lighter
  // core and a row of suckers, waving about the straight line it hits along
  // (never further from it than its hitbox reaches).
  drawTentacle(ctx, tentacle, size) {
    const { from } = tentacle;
    const tip = this.tipOf(tentacle);
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len;
    const ny = dx / len;
    const width = this.tentacleWidth * size;
    if (this.holy) {
      this.drawBeam(ctx, from, tip, width);
      return;
    }
    const amp = width * 0.5;
    const waves = Math.max(1, len / (90 * size));
    const t = this.time * 5 + tentacle.phase;
    const grab = Math.max(0, 1 - (this.time - tentacle.grabAt) / GRAB_TIME);
    const pts = new Array(TENTACLE_POINTS + 1);
    for (let i = 0; i <= TENTACLE_POINTS; i++) {
      const s = i / TENTACLE_POINTS;
      const wave = Math.sin(s * waves * TAU - t) * amp * Math.sin(Math.PI * Math.min(1, s * 1.2));
      // A stretch bends it out towards whoever it grabbed, most where it grabbed them.
      const bend = grab > 0 ? grab * Math.max(0, 1 - Math.abs(s - tentacle.grabT) / 0.3) : 0;
      pts[i] = { x: from.x + dx * s + nx * wave + tentacle.grabX * bend, y: from.y + dy * s + ny * wave + tentacle.grabY * bend };
    }
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= TENTACLE_POINTS; i++) ctx.lineTo(pts[i].x, pts[i].y);
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = UNHOLY.edge;
    ctx.lineWidth = width * 2;
    path();
    ctx.stroke();
    ctx.strokeStyle = UNHOLY.flesh;
    ctx.lineWidth = width * 1.6;
    path();
    ctx.stroke();
    ctx.strokeStyle = UNHOLY.light;
    ctx.lineWidth = width * 0.6;
    path();
    ctx.stroke();
    // Suckers along one side
    ctx.fillStyle = UNHOLY.sucker;
    for (let i = 1; i < TENTACLE_POINTS; i += 2) {
      const p = pts[i];
      ctx.beginPath();
      ctx.arc(p.x + nx * width * 0.45, p.y + ny * width * 0.45, width * 0.22, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // Priest: a straight beam of light, pulsing, with motes drifting along it.
  drawBeam(ctx, from, tip, width) {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 9);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = HOLY.rim;
    ctx.lineWidth = width * 2.6 * pulse;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = HOLY.flesh;
    ctx.lineWidth = width * 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = HOLY.light;
    ctx.lineWidth = width * 0.6;
    ctx.stroke();
    ctx.fillStyle = HOLY.light;
    for (let i = 0; i < 6; i++) {
      const s = (this.time * 0.8 + i / 6) % 1;
      ctx.globalAlpha = 0.9 * Math.sin(Math.PI * s);
      ctx.beginPath();
      ctx.arc(from.x + dx * s, from.y + dy * s, width * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHitbox(ctx) {
    super.drawHitbox(ctx);
    if (this.tentacles.length === 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = this.tentacleWidth * this.owner.size * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const tentacle of this.tentacles) {
      const tip = this.tipOf(tentacle);
      ctx.moveTo(tentacle.from.x, tentacle.from.y);
      ctx.lineTo(tip.x, tip.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
