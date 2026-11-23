import { Weapon } from './Weapon.js';
import { TAU, closestPointOnSegment, distance } from '../sim/math.js';
import { projectileBlockedBy } from './projectile.js';

const ORB = '#ff9ee8';
const ORB_CORE = '#ffffff';
const STAR = '#ffd84a';
const STAR_EDGE = '#e0a81c';
const POP_TIME = 0.28; // s a pop's ring takes to spread and fade
const SETTLE_RATE = 6; // how quickly orbs spread back out evenly after one comes or goes (per second)
const WRIGGLE_SPEED = 90; // px/s a Wild Magic orb crawls at
const WRIGGLE_TURN = 14; // rad/s, most it turns at random
const SPIKE_WIDTH = 0.55; // a Geomancer spike's half-width, as a share of the orb's radius
export const WILD_COLORS = ['#ff9ee8', '#9ee8ff', '#c7ff9e', '#ffe39e', '#c49eff'];
// Each element's pop colour, in the order a mixed pop lists them.
const ELEMENT_COLORS = [
  ['earth', '#a68a64'],
  ['water', '#7fd3ff'],
  ['air', '#e8f6ff'],
  ['wild', '#c49eff'],
  ['fire', '#ff8a3d'],
];

// A fairy wand. A short stick with a star on the end spins around the ball
// like any blade (a light bonk that parries and blocks as usual), while magic
// orbs gather in orbit around the ball, one every `orbInterval` up to
// `maxOrbs`. They never leave the orbit: an orb pops on the first enemy thing
// it touches, a ball, blade, shield or (with `swattable`) a drone. Every enemy
// within `blastRadius` of the pop takes a weapon hit (crits, lifesteal, armor
// and so on apply) and is blasted away from it, so an orb popped on a blade
// still catches its ball if it's close. Every enemy a pop catches makes the
// next pops hurt more.
//
// An orb knocked out by an enemy's guard (blade, shield or drone) does no
// blast, but `guardLeak` of its pop damage still reaches that enemy for sure:
// plain damage, like Thorns, that can't be dodged or blocked.
//
// The orbs are spaced evenly around the orbit; when one pops or a new one
// appears (in the widest gap), the rest slide back to even spacing.
//
// Royale: the orbit, the orbs and the blast grow with the ball (they're worked
// out from `owner.size` as they're used).
//
// While a pop is being dealt with `popping` is true, so per-hit stats (damage,
// knockback, scaling) can tell its hits from the stick's.
//
// Transformations (src/upgrades/wand-transformations.js) reshape the orbs
// through these fields: `elements` (which of fire, air, water, earth and wild
// they carry; any mix, and the drawing blends them), `orbsTouch` (false: they
// never pop, Pyromancer), `ring` (the Pyromancer, whose ring of fire stands in
// for the orbs), `spikeLength` (above 0: each orb is a stone spike pointing
// out from the orbit, Geomancer) and `wander` (px an orb wriggles about its
// place, Wild Magic). Each orb is an object (see newOrb) with its own `scale`
// and damage `share` (Evoker's small bubbles). `blast` is a pop without an
// orb, for orbs that aren't in orbit (Artificer's). Upgrades with
// `onOrbPop(orb, pos, sim)` hear about every orb that pops.
export class Wand extends Weapon {
  static id = 'wand';
  static displayName = 'Wand';
  static hue = 180;

  constructor(owner) {
    super(owner);
    // The stick
    this.damage = 2;
    this.spinSpeed = 3;
    this.length = 46;
    this.gap = 3;
    this.thickness = 4;
    this.model = 'star'; // how the stick is drawn: 'star', or 'staff' (Merlin)

    // The orbs
    this.popDamage = 6; // per enemy caught in a pop
    this.popDamagePerHit = 0.3; // added to popDamage for each enemy a pop catches
    this.popKnockback = 1.3; // knockback multiplier on a pop
    this.guardLeak = 0.3; // share of popDamage dealt anyway when an orb is knocked out by a guard
    this.blastRadius = 45; // px from the pop to an enemy's edge
    this.orbRadius = 10; // px, each orb's hitbox and drawing
    this.orbitDistance = 36; // px from the ball's surface to the orbs' centres
    this.orbitSpeed = 2.4; // rad/s the orbit turns at
    this.orbInterval = 2.2; // s to conjure an orb
    this.maxOrbs = 5;
    this.swattable = false; // true: enemy drones pop orbs too

    // Set by transformations, see above.
    this.elements = { fire: false, air: false, water: false, earth: false, wild: false };
    this.ring = null; // the Pyromancer upgrade, if any
    this.popColorList = null; // see popColors, worked out at the first pop
    this.orbsTouch = true;
    this.spikeLength = 0; // px past the orb's centre
    this.wander = 0; // px
    this.maxSmallOrbs = 6; // Evoker's small orbs, on top of maxOrbs

    // The orbs, in order around the orbit. The first is the anchor; the rest
    // follow it, settling to even spacing.
    this.orbsMade = 0; // counts orbs as they're made, to colour Wild Magic's
    this.orbs = [this.newOrb(0), this.newOrb(Math.PI)]; // it starts with a couple ready
    this.orbTimer = this.orbInterval; // s until the next orb appears
    this.orbitAngle = Math.random() * TAU;
    this.pops = []; // { pos, radius, timeLeft }, for drawing only
    this.popping = false; // see above
    this.popShare = 1; // the popping orb's damage share
    this.time = 0; // s, for drawing
  }

  // An orb at `angle` (relative to `orbitAngle`). A small one (Evoker) is half
  // the size and does `share` of the damage; small ones never count towards
  // `maxOrbs`. `ox`/`oy`/`heading` are its wriggle (Wild Magic); `hue` picks
  // its Wild Magic colour, fixed for its life.
  newOrb(angle, small = false, share = 1) {
    const hue = this.orbsMade++ % WILD_COLORS.length;
    return { angle, small, scale: small ? 0.5 : 1, share, ox: 0, oy: 0, heading: 0, hue };
  }

  // Orbs that count towards maxOrbs.
  get fullOrbs() {
    let n = 0;
    for (const orb of this.orbs) if (!orb.small) n++;
    return n;
  }

  // A pop does its own damage; the stick does `damage`.
  get baseDamage() {
    return this.popping ? this.popDamage * this.popShare : this.damage;
  }

  get knockbackMultiplier() {
    return super.knockbackMultiplier * (this.popping ? this.popKnockback : 1);
  }

  onHit() {
    if (this.popping) this.popDamage += this.popDamagePerHit;
  }

  // Distance from the ball's centre to the orbiting orbs' centres.
  get orbitRadius() {
    return this.owner.radius + this.orbitDistance * this.owner.size;
  }

  // Where orb `i` is right now.
  orbPos(i) {
    const { pos, size } = this.owner;
    const orb = this.orbs[i];
    const angle = this.orbitAngle + orb.angle;
    const r = this.orbitRadius;
    return { x: pos.x + Math.cos(angle) * r + orb.ox * size, y: pos.y + Math.sin(angle) * r + orb.oy * size };
  }

  // Orb `i`'s hitbox radius right now.
  orbReach(i) {
    return this.orbRadius * this.owner.size * this.orbs[i].scale;
  }

  // Geomancer: orb `i`'s spike, from its root on the orbit out to its tip.
  spikeOf(i) {
    const pos = this.orbPos(i);
    const angle = this.orbitAngle + this.orbs[i].angle;
    const out = this.spikeLength * this.owner.size * this.orbs[i].scale;
    const back = this.orbReach(i);
    return {
      a: { x: pos.x - Math.cos(angle) * back, y: pos.y - Math.sin(angle) * back },
      b: { x: pos.x + Math.cos(angle) * out, y: pos.y + Math.sin(angle) * out },
    };
  }

  update(dt, sim) {
    super.update(dt, sim);
    this.time += dt;
    this.orbitAngle += this.orbitSpeed * this.spinDir * dt;
    if (this.fullOrbs < this.maxOrbs) {
      this.orbTimer -= dt;
      if (this.orbTimer <= 0) {
        this.addOrb();
        this.orbTimer = this.orbInterval;
      }
    }
    this.settleOrbs(dt);
    if (this.wander > 0) this.wriggleOrbs(dt);
    if (!sim.over && this.orbsTouch) this.touchOrbs(sim);
    if (this.pops.length > 0) {
      for (const pop of this.pops) pop.timeLeft -= dt;
      this.pops = this.pops.filter((pop) => pop.timeLeft > 0);
    }
  }

  // A new orb, in the middle of the widest gap.
  addOrb(small = false, share = 1) {
    const { orbs } = this;
    if (orbs.length === 0) {
      orbs.push(this.newOrb(0, small, share));
      return;
    }
    let at = orbs.length; // the gap from the last orb round to the first
    let widest = orbs[0].angle + TAU - orbs[orbs.length - 1].angle;
    for (let i = 1; i < orbs.length; i++) {
      if (orbs[i].angle - orbs[i - 1].angle > widest) {
        widest = orbs[i].angle - orbs[i - 1].angle;
        at = i;
      }
    }
    this.insertOrb(at, small, share);
  }

  // A new orb in the gap just before orb `at` (`orbs.length`: the gap from the
  // last round to the first).
  insertOrb(at, small = false, share = 1) {
    const { orbs } = this;
    if (orbs.length === 0) {
      orbs.push(this.newOrb(0, small, share));
      return;
    }
    const before = at === 0 ? orbs[orbs.length - 1].angle - TAU : orbs[at - 1].angle;
    const after = at === orbs.length ? orbs[0].angle + TAU : orbs[at].angle;
    orbs.splice(at, 0, this.newOrb(before + (after - before) / 2, small, share));
  }

  // Slides the orbs towards even spacing around the first one.
  settleOrbs(dt) {
    const { orbs } = this;
    const n = orbs.length;
    if (n < 2) return;
    const k = Math.min(1, SETTLE_RATE * dt);
    const first = orbs[0].angle;
    for (let i = 1; i < n; i++) {
      const target = first + (i * TAU) / n;
      orbs[i].angle += (target - orbs[i].angle) * k;
    }
  }

  // Wild Magic: each orb crawls about its place like a worm, turning at
  // random, and turns back once it strays `wander` px from it.
  wriggleOrbs(dt) {
    const speed = WRIGGLE_SPEED;
    for (const orb of this.orbs) {
      orb.heading += (Math.random() * 2 - 1) * WRIGGLE_TURN * dt;
      if (orb.ox * orb.ox + orb.oy * orb.oy > this.wander * this.wander) {
        // Head back towards its place, whichever way is the shorter turn.
        const home = Math.atan2(-orb.oy, -orb.ox);
        let diff = home - orb.heading;
        diff -= Math.round(diff / TAU) * TAU;
        orb.heading += diff * Math.min(1, 8 * dt);
      }
      orb.ox += Math.cos(orb.heading) * speed * dt;
      orb.oy += Math.sin(orb.heading) * speed * dt;
    }
  }

  // Pops every orb touching an enemy ball, blade or shield (or a drone, if
  // `swattable`). Last first, so removing one leaves the others' indices alone.
  touchOrbs(sim) {
    const { owner } = this;
    const spikes = this.spikeLength > 0;
    // Too far for an orb to touch anything of the enemy's.
    const orbReach = this.orbitRadius + (this.wander + this.orbRadius + this.spikeLength) * owner.size;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const pos = this.orbPos(i);
      // A spike is thinner than an orb, and long.
      const reach = spikes ? this.orbReach(i) * SPIKE_WIDTH : this.orbReach(i);
      const spike = spikes ? this.spikeOf(i) : null;
      for (const enemy of sim.aliveBalls) {
        if (enemy === owner) continue;
        const centre = distance(enemy.pos, owner.pos);
        if (!this.swattable && centre - orbReach > Math.max(enemy.weapon.guardReach, enemy.radius) + reach) continue;
        const near = spike ? closestPointOnSegment(enemy.pos, spike.a, spike.b) : pos;
        if (distance(enemy.pos, near) < enemy.radius + reach) {
          this.pop(i, spike ? near : pos, sim);
          break;
        }
        const touch = spike
          ? projectileBlockedBy(this, spike.a, spike.b, enemy, reach, this.swattable)
          : projectileBlockedBy(this, pos, pos, enemy, reach, this.swattable);
        if (touch) {
          if (touch.drone) enemy.weapon.swat(touch.drone, owner, touch.point, sim);
          else if (touch.shield) {
            sim.onEvent('block', { attacker: owner, defender: enemy, point: touch.point });
            enemy.weapon.registerBlock(this, sim); // Shield Bash
          } else sim.onEvent('parry', { a: owner, b: enemy, point: touch.point });
          const share = this.orbs[i].share;
          this.fizzle(i, touch.point, sim);
          sim.dealDamage(owner, enemy, this.popDamage * share * this.guardLeak, { reason: 'wand-leak', color: ORB });
          break;
        }
      }
      if (sim.over) return;
    }
  }

  // Orb `i` is knocked out by an enemy's guard: gone, with a puff of sparkles and no damage.
  fizzle(i, pos, sim) {
    this.removeOrb(i);
    sim.onEvent('ability', { ball: this.owner, ability: null, phase: 'fizzle', pos, burst: { color: ORB, count: 6, speed: 90, life: 0.25, size: 1.8 } });
  }

  // Takes orb `i` out of the orbit and returns it.
  removeOrb(i) {
    const [orb] = this.orbs.splice(i, 1);
    if (!orb.small && this.fullOrbs === this.maxOrbs - 1) this.orbTimer = this.orbInterval;
    return orb;
  }

  // Orb `i` bursts at `pos`.
  pop(i, pos, sim) {
    const orb = this.removeOrb(i);
    this.blast(pos, orb.scale, orb.share, sim);
    for (const upgrade of this.upgradesWith('onOrbPop')) upgrade.onOrbPop(orb, i, pos, sim);
  }

  // A pop at `pos`, `scale` times the size, doing `share` of the damage: a
  // weapon hit on every enemy within reach, each blasted straight away from it.
  blast(pos, scale, share, sim) {
    const { owner } = this;
    const reach = this.blastRadius * owner.size * scale;
    this.popping = true;
    this.popShare = share;
    // A copy: a knockout changes aliveBalls.
    for (const enemy of [...sim.aliveBalls]) {
      if (enemy === owner || !enemy.alive || distance(enemy.pos, pos) - enemy.radius > reach) continue;
      sim.applyHit(owner, enemy, pos);
    }
    this.popping = false;
    this.popShare = 1;
    this.pops.push({ pos, radius: reach, timeLeft: POP_TIME });
    // A mixed pop's sparks take each of its colours in turn.
    const colors = this.popColors;
    const color = colors[this.pops.length % colors.length];
    sim.onEvent('ability', { ball: owner, ability: null, phase: 'pop', pos, shake: 3 * scale, burst: { color, count: Math.round(18 * scale), speed: 260, life: 0.4, size: 2.5 } });
  }

  // The colours of a pop: one per element the orbs carry, or plain pink.
  get popColors() {
    if (this.popColorList === null) {
      const list = ELEMENT_COLORS.filter(([element]) => this.elements[element]).map(([, color]) => color);
      this.popColorList = list.length > 0 ? list : [ORB];
    }
    return this.popColorList;
  }

  // ---- Drawing ------------------------------------------------------------------

  // A thin white stick with a gold band at the grip and a five-point gold star
  // on the end, pointing along +x.
  drawLocal(ctx, start) {
    if (this.model === 'staff') {
      this.drawStaff(ctx, start);
      return;
    }
    const end = start + this.length;
    const starR = 10;
    const tip = end - starR * 0.6;

    // Stick, with a darker grip
    ctx.fillStyle = '#fdf6ff';
    ctx.fillRect(start, -1.8, tip - start, 3.6);
    ctx.fillStyle = '#c99be0';
    ctx.fillRect(start, -2.3, 10, 4.6);
    ctx.fillStyle = STAR;
    ctx.fillRect(start + 10, -2.5, 2.5, 5);

    // Star, a little glow behind it
    ctx.save();
    ctx.translate(tip, 0);
    ctx.fillStyle = 'rgba(255, 236, 140, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, starR + 3, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? starR : starR * 0.45;
      const a = (i * Math.PI) / 5;
      if (i === 0) ctx.moveTo(r, 0);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = STAR;
    ctx.fill();
    ctx.strokeStyle = STAR_EDGE;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // Merlin's wand: dark carved wood wound with gold, a gold pommel, and a
  // glowing crystal held in gold prongs at the end, a sparkle turning on it.
  drawStaff(ctx, start) {
    const end = start + this.length;
    const head = end - 8; // the crystal's centre
    ctx.save();
    ctx.lineJoin = 'round';

    // Shaft, tapering towards the head
    const wood = ctx.createLinearGradient(0, -3, 0, 3);
    wood.addColorStop(0, '#8a5a34');
    wood.addColorStop(1, '#3a2010');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.moveTo(start + 2, -2.6);
    ctx.lineTo(head - 6, -1.7);
    ctx.lineTo(head - 6, 1.7);
    ctx.lineTo(start + 2, 2.6);
    ctx.closePath();
    ctx.fill();
    // Gold winding
    ctx.strokeStyle = STAR;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let wx = start + 12; wx < head - 8; wx += 5) {
      ctx.moveTo(wx, -2.3);
      ctx.lineTo(wx + 2.5, 2.3);
    }
    ctx.stroke();
    // Grip and pommel
    ctx.fillStyle = '#4a2a5e';
    ctx.fillRect(start + 2, -2.9, 8, 5.8);
    ctx.fillStyle = STAR;
    ctx.strokeStyle = STAR_EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(start + 2, 0, 3.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(start + 10, -3.2, 2, 6.4);

    // Glow round the crystal
    const pulse = 1 + 0.12 * Math.sin(this.time * 5);
    ctx.fillStyle = 'rgba(159, 230, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(head, 0, 11 * pulse, 0, TAU);
    ctx.fill();
    // Prongs curling round it
    ctx.strokeStyle = STAR_EDGE;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const dir of [-1, 1]) {
      ctx.moveTo(head - 7, dir * 1.5);
      ctx.quadraticCurveTo(head - 5, dir * 7, head + 1, dir * 5.5);
    }
    ctx.stroke();
    // Crystal
    ctx.fillStyle = '#c8f2ff';
    ctx.strokeStyle = '#4fa8d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(head - 5, 0);
    ctx.lineTo(head, -4.5);
    ctx.lineTo(head + 8, 0);
    ctx.lineTo(head, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(head - 3, 0);
    ctx.lineTo(head, -3);
    ctx.lineTo(head + 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = STAR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(head - 6, -3);
    ctx.lineTo(head - 6, 3);
    ctx.stroke();
    // A four-pointed sparkle turning on the crystal
    const a = this.time * 3;
    const k = 0.6 + 0.4 * Math.abs(Math.sin(this.time * 4));
    ctx.save();
    ctx.translate(head + 2, -1);
    ctx.rotate(a);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const d = i % 2 === 0 ? 5 * k : 1.2;
      const t = (i * Math.PI) / 4;
      ctx.lineTo(Math.cos(t) * d, Math.sin(t) * d);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  draw(ctx) {
    const { owner } = this;
    const r = this.orbRadius * owner.size;

    // Pop rings, under everything else of ours: a band of each element's
    // colour, one inside the next, with a white rim.
    const colors = this.popColors;
    for (const pop of this.pops) {
      const t = 1 - pop.timeLeft / POP_TIME;
      const radius = pop.radius * Math.sqrt(t);
      ctx.save();
      for (let k = colors.length - 1; k >= 0; k--) {
        ctx.globalAlpha = 0.3 * (1 - t);
        ctx.fillStyle = colors[k];
        ctx.beginPath();
        ctx.arc(pop.pos.x, pop.pos.y, (radius * (k + 1)) / colors.length, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 0.9 * (1 - t);
      ctx.strokeStyle = ORB_CORE;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(pop.pos.x, pop.pos.y, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    super.draw(ctx);

    if (this.ring !== null) return; // the ring of fire is drawn instead (Pyromancer)
    for (let i = 0; i < this.orbs.length; i++) this.drawOrbAt(ctx, i, r * this.orbs[i].scale);
  }

  // Orb `i`, blending whatever elements it carries: earth gives it its shape
  // (a spike), water makes it a bubble, wild colours it and air swirls round it.
  drawOrbAt(ctx, i, r) {
    const pos = this.orbPos(i);
    const { air, water, earth, wild } = this.elements;
    const tint = wild ? WILD_COLORS[this.orbs[i].hue] : null;
    const spin = this.time * 6 + i;
    if (earth) {
      const spike = this.spikeOf(i);
      drawSpike(ctx, spike, r * SPIKE_WIDTH, water, tint);
      if (air) {
        // The curls ride the middle of the spike.
        MID.x = (spike.a.x + spike.b.x) / 2;
        MID.y = (spike.a.y + spike.b.y) / 2;
        drawCurls(ctx, MID, r * 1.2, spin);
      }
      return;
    }
    if (water) drawBubble(ctx, pos, r, this.time + i, tint);
    else if (air && tint === null) drawAirball(ctx, pos, r);
    else drawOrb(ctx, pos, r, tint ?? ORB);
    if (air) drawCurls(ctx, pos, r, spin);
  }

  drawHitbox(ctx) {
    super.drawHitbox(ctx);
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
    ctx.lineWidth = 1.5;
    if (this.ring !== null) {
      // The band the ring of fire burns in.
      const { inner, outer } = this.ring.band();
      const { x, y } = this.owner.pos;
      for (const r of [this.orbitRadius - inner, this.orbitRadius + outer]) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, r), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    for (let i = 0; i < this.orbs.length; i++) {
      if (this.spikeLength > 0) {
        const { a, b } = this.spikeOf(i);
        ctx.lineWidth = this.orbReach(i) * SPIKE_WIDTH * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        continue;
      }
      const { x, y } = this.orbPos(i);
      ctx.beginPath();
      ctx.arc(x, y, this.orbReach(i), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// A glowing orb (pink unless told otherwise) with a white heart.
function drawOrb(ctx, pos, r, color = ORB) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r * 1.6, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ORB_CORE;
  ctx.beginPath();
  ctx.arc(pos.x - r * 0.25, pos.y - r * 0.25, r * 0.45, 0, TAU);
  ctx.fill();
}

const MID = { x: 0, y: 0 }; // scratch point for drawing

// A see-through soap bubble with a shine, wobbling a little: blue, or tinted
// `tint` (Wild Magic).
function drawBubble(ctx, pos, r, t, tint = null) {
  const wobble = 1 + 0.06 * Math.sin(t * 5);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y, r * wobble, r / wobble, 0, 0, TAU);
  if (tint === null) {
    ctx.fillStyle = 'rgba(127, 211, 255, 0.25)';
    ctx.strokeStyle = 'rgba(190, 236, 255, 0.95)';
    ctx.fill();
  } else {
    ctx.fillStyle = tint;
    ctx.strokeStyle = tint;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(pos.x - r * 0.35, pos.y - r * 0.35, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// A pale ball of wind: a faint disc (its curls are drawn by drawCurls).
function drawAirball(ctx, pos, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(232, 246, 255, 0.3)';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Two white curls of wind swirling round `pos`.
function drawCurls(ctx, pos, r, spin) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * (0.5 + 0.35 * k), spin + k * Math.PI, spin + k * Math.PI + 2.2);
    ctx.stroke();
  }
  ctx.restore();
}

// A rough stone spike from `a` (its root) to `b` (its point). `wet` makes it
// dark, blue-grey and glistening (Hydromancer); `tint` gives it a glowing
// edge in that colour (Wild Magic).
function drawSpike(ctx, { a, b }, half, wet = false, tint = null) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x + nx * 1.4, a.y + ny * 1.4);
  ctx.lineTo(a.x + dx * 0.5 + nx * 0.8, a.y + dy * 0.5 + ny * 0.8);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(a.x + dx * 0.55 - nx * 0.7, a.y + dy * 0.55 - ny * 0.7);
  ctx.lineTo(a.x - nx * 1.4, a.y - ny * 1.4);
  ctx.closePath();
  if (tint !== null) {
    // A glow of its colour behind it.
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = wet ? '#5f7f96' : '#8d7353';
  ctx.strokeStyle = tint ?? (wet ? '#2f4a5e' : '#4e3d28');
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = wet ? 'rgba(190, 236, 255, 0.85)' : 'rgba(255, 240, 210, 0.45)';
  ctx.lineWidth = wet ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x + dx * 0.15, a.y + dy * 0.15);
  ctx.lineTo(a.x + dx * 0.7 + nx * 0.2, a.y + dy * 0.7 + ny * 0.2);
  ctx.stroke();
  if (wet) {
    // A drop hanging off the point.
    ctx.fillStyle = 'rgba(127, 211, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(b.x - (dx / len) * half * 0.6, b.y - (dy / len) * half * 0.6, half * 0.45, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
