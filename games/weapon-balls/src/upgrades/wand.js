import { Upgrade } from './Upgrade.js';
import { Status } from '../sim/Status.js';
import { TAU, hypot } from '../sim/math.js';
import { PYRO_UPGRADE_SCALE } from './wand-transformations.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Wand: its orbs' size, reach, pace and what a pop
// does. They work through the Wand's orb stats and its `onOrbPop` hook, and
// with Pyromancer through `onRingBurn` (see Wand.js and wand-transformations.js).

// True for a weapon hit from one of the Wand's pops (not the stick, not a
// secondary hit).
function fromPop(weapon, hit) {
  return weapon.popping && !hit.secondary;
}

// ---- Thick Orbs -------------------------------------------------------------------

const THICK_ORBS = 0.25; // bigger orbs, per copy

export class ThickOrbs extends Upgrade {
  static id = 'thick-orbs';
  static displayName = 'Thick Orbs';
  static describe(n) {
    return `Your orbs are ${percent(THICK_ORBS * n)} bigger, so they touch more. With Pyromancer, the ring of fire is that much wider.`;
  }
  static weapons = ['wand'];

  apply() {
    const { weapon } = this;
    this.base ??= weapon.orbRadius;
    weapon.orbRadius += this.base * THICK_ORBS;
  }
}

// ---- Echo -------------------------------------------------------------------------

const ECHO_SHARE = 0.5; // each echo does this share of the one before
const ECHO_DELAY = 0.3; // s between echoes
const ECHO_RING = 0.15; // Pyromancer: one fainter burn after each, this share of it per copy (before PYRO_UPGRADE_SCALE)
const ECHO_COLOR = '#d9b8ff';

export class Echo extends Upgrade {
  static id = 'echo';
  static displayName = 'Echo';
  static describe(n) {
    const shares = [];
    for (let k = 1; k <= n; k++) shares.push(percent(Math.pow(ECHO_SHARE, k)));
    const echoes = n === 1 ? 'pops again a moment later' : `echoes ${n} more times, a moment apart`;
    return `Every orb ${echoes} in the same place, for ${shares.join(', then ')} damage. With Pyromancer, every burn echoes once instead, for ${percent(ECHO_RING * PYRO_UPGRADE_SCALE * n)} damage.`;
  }
  static weapons = ['wand'];

  constructor(weapon) {
    super(weapon);
    // Echoes waiting to go off: { pos, scale, share, target, timeLeft }. A
    // pop's echo has a `pos`; a burn's (Pyromancer) has a `target` and its
    // damage in `share`.
    this.pending = [];
  }

  onOrbPop(orb, i, pos, sim) {
    for (let k = 1; k <= this.stacks; k++) {
      const share = orb.share * Math.pow(ECHO_SHARE, k);
      this.pending.push({ pos: { x: pos.x, y: pos.y }, scale: orb.scale, share, target: null, timeLeft: ECHO_DELAY * k });
    }
  }

  // Pyromancer: each burn that lands burns once more, fainter, a moment later.
  // Burns come dozens a second, so this echo is much quieter than a pop's.
  onRingBurn(enemy, sim) {
    const { weapon } = this;
    const { ring } = weapon;
    const damage = weapon.popDamage * ring.share * ECHO_RING * ring.upgradeScale * this.stacks;
    this.pending.push({ pos: null, scale: 1, share: damage, target: enemy, timeLeft: ECHO_DELAY });
  }

  onUpdate(dt, sim) {
    const { pending } = this;
    if (pending.length === 0) return;
    if (sim.over) {
      pending.length = 0;
      return;
    }
    let kept = 0;
    for (let i = 0; i < pending.length; i++) {
      const echo = pending[i];
      echo.timeLeft -= dt;
      if (echo.timeLeft > 0) {
        pending[kept++] = echo;
        continue;
      }
      if (sim.over) continue;
      if (echo.target === null) this.weapon.blast(echo.pos, echo.scale, echo.share, sim);
      else if (echo.target.alive) sim.applySecondaryHit(this.owner, echo.target, echo.share, { reason: 'echo', color: ECHO_COLOR, quiet: true, upgradeScale: this.weapon.ring.upgradeScale });
    }
    pending.length = kept;
  }

  onGrow(factor) {
    // A pop's echo is as big as the pop was: blast() measures it by the ball's
    // size when it goes off, so take the growth back out of its scale.
    for (const echo of this.pending) echo.scale /= factor;
  }
}

// ---- Magnetism --------------------------------------------------------------------

const MAGNET_HOLD = 1; // s a pop holds an enemy in your orbit
const MAGNET_COOLDOWN = 2.5; // s after a hold ends before that enemy can be held again
const MAGNET_RING_HOLD = 0.4; // Pyromancer: s the ring's burns hold an enemy in the flames
const MAGNET_RING_COOLDOWN = 5; // and s before it can do so again
const MAGNET_EXPOSED = 1.4; // damage taken multiplier while held by a pop (not by the ring)
const MAGNET_GAIN = 7; // per s: how hard the hold steers them back onto the orbit
const MAGNET_GRIP = 12; // per s: how quickly their speed in and out is taken over
const MAGNET_COLOR = '#ff6b9e';

export class Magnetism extends Upgrade {
  static id = 'magnetism';
  static displayName = 'Magnetism';
  static description = `A pop that hits an enemy holds them in your orbit for ${MAGNET_HOLD}s, where your other orbs come round to them: they can slide along it, but not get away or in close, and take ${percent(MAGNET_EXPOSED - 1)} more damage. Once free, they can't be held again for ${MAGNET_COOLDOWN}s. With Pyromancer, the ring's burns hold them in the flames instead, for ${MAGNET_RING_HOLD}s every ${MAGNET_RING_HOLD + MAGNET_RING_COOLDOWN}s at most, with no extra damage.`;
  static weapons = ['wand'];
  static maxStacks = 1;
  // Aeromancer's whole point is the blast away.
  static excludedBy = ['aeromancer'];

  constructor(weapon) {
    super(weapon);
    this.freeUntil = new Map(); // ball -> sim time it can be held again
  }

  onHit(target, sim, damage, point, hit = {}) {
    if (!fromPop(this.weapon, hit)) return;
    this.hold(target, sim, MAGNET_HOLD, MAGNET_COOLDOWN, MAGNET_EXPOSED);
  }

  onRingBurn(enemy, sim) {
    this.hold(enemy, sim, MAGNET_RING_HOLD, MAGNET_RING_COOLDOWN, 1);
  }

  hold(target, sim, duration, cooldown, exposed) {
    if (!target.alive || sim.over || target.hasStatus(Magnetized)) return;
    if ((this.freeUntil.get(target) ?? -Infinity) > sim.time) return;
    this.freeUntil.set(target, sim.time + duration + cooldown);
    target.addStatus(new Magnetized({ source: this.owner, duration, exposed }), sim);
    this.emit(sim, 'magnet', { pos: target.pos, burst: { color: MAGNET_COLOR, count: 8, speed: 140, life: 0.3, size: 2 } });
  }
}

// Held in a Wand's orbit (Magnetism): every step its speed in or out from the
// wand is steered so its near edge sits on the orbit, where the orbs touch
// it, while its speed along the orbit is left alone.
export class Magnetized extends Status {
  constructor({ source, duration, exposed }) {
    super({ source, duration });
    this.exposed = exposed; // damage taken multiplier
  }

  get damageTakenMultiplier() {
    return this.exposed;
  }

  onUpdate(dt) {
    const { source, ball } = this;
    if (!source.alive) {
      this.timeLeft = 0;
      return;
    }
    const dx = ball.pos.x - source.pos.x;
    const dy = ball.pos.y - source.pos.y;
    const len = hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const off = len - ball.radius - source.weapon.orbitRadius; // above 0: its edge is outside the orbit
    const most = ball.speed * 1.5;
    const want = Math.max(-most, Math.min(most, -off * MAGNET_GAIN));
    const now = ball.vel.x * nx + ball.vel.y * ny;
    const change = (want - now) * Math.min(1, MAGNET_GRIP * dt);
    ball.vel.x += nx * change;
    ball.vel.y += ny * change;
  }

  // A pink tether back to the wand, and a ring round the ball.
  draw(ctx) {
    const { source, ball } = this;
    const fade = Math.min(1, this.timeLeft / 0.3);
    ctx.save();
    ctx.strokeStyle = MAGNET_COLOR;
    ctx.globalAlpha = 0.35 * fade;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -this.age * 40;
    ctx.beginPath();
    ctx.moveTo(source.pos.x, source.pos.y);
    ctx.lineTo(ball.pos.x, ball.pos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8 * fade;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.pos.x, ball.pos.y, ball.radius + 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Panic Button -----------------------------------------------------------------

const PANIC_BUTTON = 0.4; // faster orbs while an enemy is close, per copy
const PANIC_RANGE = 160; // px between the balls' edges

export class PanicButton extends Upgrade {
  static id = 'panic-button';
  static displayName = 'Panic Button';
  static describe(n) {
    return `While an enemy is close, new orbs appear ${percent(PANIC_BUTTON * n)} faster. With Pyromancer, the ring builds up faster.`;
  }
  static weapons = ['wand'];

  onUpdate(dt, sim) {
    const { weapon } = this;
    if (sim.over || weapon.fullOrbs >= weapon.maxOrbs || !this.enemyWithin(sim, PANIC_RANGE)) return;
    // The Wand counts down by dt itself, just after this.
    weapon.orbTimer -= dt * PANIC_BUTTON * this.stacks;
  }
}

// ---- Big Ring ---------------------------------------------------------------------

const BIG_RING = 0.25; // further out orbit, per copy

export class BigRing extends Upgrade {
  static id = 'big-ring';
  static displayName = 'Big Ring';
  static describe(n) {
    return `Your orbs circle ${percent(BIG_RING * n)} further out from your ball. With Pyromancer, so does the ring of fire.`;
  }
  static weapons = ['wand'];

  apply() {
    const { weapon } = this;
    this.base ??= weapon.orbitDistance;
    weapon.orbitDistance += this.base * BIG_RING;
  }
}
