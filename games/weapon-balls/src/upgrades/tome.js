import { Upgrade } from './Upgrade.js';
import { Status } from '../sim/Status.js';
import { TAU } from '../sim/math.js';
import { percent } from '../utils/format.js';

// Small upgrades for the Tome: its portals and tentacles. They work through
// the Tome's stats (`maxPortals`, `tentacleWidth`, `tentacleStretch`,
// `tentacleTick`, see Tome.js), and a lash's hit reaches `onHit` as a
// secondary hit with `reason: 'tentacle'`.

// ---- More Portals -----------------------------------------------------------------

const MORE_PORTALS = 1; // more open at once, per copy

export class MorePortals extends Upgrade {
  static id = 'more-portals';
  static displayName = 'More Portals';
  static describe(n) {
    const more = MORE_PORTALS * n;
    return `You can hold ${more === 1 ? 'one more portal' : `${more} more portals`} open at a time.`;
  }
  static weapons = ['tome'];

  apply() {
    this.weapon.maxPortals += MORE_PORTALS;
  }
}

// ---- Thick Tentacles --------------------------------------------------------------

const THICK_TENTACLES = 0.75; // wider, per copy

export class ThickTentacles extends Upgrade {
  static id = 'thick-tentacles';
  static displayName = 'Thick Tentacles';
  static describe(n) {
    return `Your tentacles are ${percent(THICK_TENTACLES * n)} thicker, so they catch more.`;
  }
  static weapons = ['tome'];

  apply() {
    const { weapon } = this;
    this.base ??= weapon.tentacleWidth;
    weapon.tentacleWidth += this.base * THICK_TENTACLES;
  }
}

// ---- Sticky Tentacles -------------------------------------------------------------

const STICKY_SLOW = 0.7; // speed multiplier while stuck, per copy
const STICKY_TIME = 0.8; // s a lash keeps them stuck (longer than between lashes, so it holds while they're in it)
const STICKY = '#9be37a';

export class StickyTentacles extends Upgrade {
  static id = 'sticky-tentacles';
  static displayName = 'Sticky Tentacles';
  static maxStacks = 3; // more would leave them crawling
  static describe(n) {
    return `Enemies your tentacles lash are ${percent(1 - Math.pow(STICKY_SLOW, n))} slower while they're caught in them.`;
  }
  static weapons = ['tome'];

  onHit(target, sim, damage, point, hit = {}) {
    if (hit.reason !== 'tentacle' || !target.alive) return;
    target.addStatus(new Stuck({ source: this.owner, duration: STICKY_TIME, slow: Math.pow(STICKY_SLOW, this.stacks) }), sim);
  }
}

// Caught in a sticky tentacle: slower (Sticky Tentacles).
export class Stuck extends Status {
  constructor({ source, duration, slow }) {
    super({ source, duration });
    this.slow = slow;
  }

  get speedMultiplier() {
    return this.slow;
  }

  // Strands of slime dripping off the ball.
  draw(ctx) {
    const { pos, radius } = this.ball;
    ctx.save();
    ctx.strokeStyle = STICKY;
    ctx.fillStyle = STICKY;
    ctx.globalAlpha = 0.7 * Math.min(1, this.timeLeft / 0.2);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const x = pos.x + (i - 1) * radius * 0.55;
      const top = pos.y + radius * (0.55 - Math.abs(i - 1) * 0.25);
      const len = 6 + 4 * Math.sin(this.age * 6 + i * 2);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, top + len, 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Stretchy Tentacles -----------------------------------------------------------

const STRETCH = 7; // px further they reach to grab someone, per copy

export class StretchyTentacles extends Upgrade {
  static id = 'stretchy-tentacles';
  static displayName = 'Stretchy Tentacles';
  static describe(n) {
    return `Your tentacles stretch out up to ${STRETCH * n}px to lash enemies passing close by.`;
  }
  static weapons = ['tome'];

  apply() {
    this.weapon.tentacleStretch += STRETCH;
  }
}

// ---- Quick Lashes -----------------------------------------------------------------

const QUICK_LASHES = 0.88; // time between lashes multiplied by this, per copy

export class QuickLashes extends Upgrade {
  static id = 'quick-lashes';
  static displayName = 'Quick Lashes';
  static describe(n) {
    return `Your tentacles lash ${percent(1 / Math.pow(QUICK_LASHES, n) - 1)} faster.`;
  }
  static weapons = ['tome'];

  apply() {
    this.weapon.tentacleTick *= QUICK_LASHES;
  }
}
