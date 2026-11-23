import { CONFIG } from '../config.js';
import { Simulation } from '../sim/Simulation.js';
import { withExactMath } from '../sim/exactMath.js';
import { mulberry32 } from '../sim/random.js';
import { formatNumber } from '../utils/format.js';
import { Effects } from './Effects.js';
import { Quality } from './Quality.js';
import { Renderer } from './Renderer.js';
import { Sound } from './Sound.js';

const AUTO_REMATCH_DELAY = 2.5; // seconds after a win
const MAX_STEPS_PER_FRAME = 40;
const CATCH_UP_AFTER = 0.5; // s behind a shared clock before effects and sound stop for the catch-up
const CATCH_UP_BUDGET = 12; // ms of sim per frame while catching up, so the page stays responsive
const realRandom = Math.random;

// Owns the browser loop: runs the simulation at a fixed rate, turns sim events
// into effects, handles pause / speed / hitstop, and draws each frame.
export class Game {
  // chooseMatch() returns the next match to play, or null to show an empty
  // arena: { fighters, seed?, timeLimit?, tiebreak?, suddenDeath?, royale?, exactMath? }, where
  // fighters are loadouts (see Simulation; `royale: true` for a royale). A seeded match plays out the same
  // way every time, and with `exactMath` the same in every browser (see src/sim/exactMath.js). suddenDeath is the sim time sudden death starts (default
  // CONFIG.suddenDeath.after, null for none). A match still going at timeLimit
  // (in sim seconds) is a draw, or with tiebreak 'hp' goes to the fighter with
  // the most HP left. onMatchEnd(sim) is
  // called once the match is decided. soundKey gives this game its own saved
  // mute switch (see Sound).
  constructor(canvas, { chooseMatch, onMatchEnd, soundKey }) {
    this.chooseMatch = chooseMatch;
    this.onMatchEnd = onMatchEnd ?? (() => {});
    this.renderer = new Renderer(canvas);
    this.effects = new Effects();
    this.sound = new Sound({ key: soundKey });
    this.fixedDt = 1 / CONFIG.physicsHz;

    // Settings the UI can change.
    this.timeScale = 1;
    this.paused = false;
    this.showHitboxes = false;
    this.autoRematch = false;
    this.endHint = 'R to restart'; // under the winner banner
    // A function giving the sim seconds this match should be at, or null to run
    // on this page's own time. See followClock.
    this.clock = null;
    // A function giving the seconds until a clock-driven match starts, shown as
    // a countdown, or null. See TournamentDisplay.
    this.startsIn = null;
    // Slot of the ball to mark, and with `zoomed` to keep the view on, or null.
    this.follow = null;
    this.zoomed = false;

    this.match = null;
    this.sim = null;
    this.random = realRandom; // what Math.random is while the sim runs
    this.accumulator = 0;
    this.hitstop = 0;
    this.timeSinceEnd = 0;
    this.catchingUp = false;
    this.lastTime = null;
    this.frameRequest = null;
    this.running = false;
    this.qualityLevel = -1; // applied lazily on the first frame
  }

  newMatch() {
    this.match = this.chooseMatch();
    this.random = this.match?.seed == null ? realRandom : mulberry32(this.match.seed);
    const onEvent = (type, data) => this.withRandom(realRandom, () => this.handleSimEvent(type, data));
    const { fighters, tiebreak, suddenDeath, royale } = this.match ?? {};
    this.sim = this.match && this.runSim(() => new Simulation(fighters, { onEvent, tiebreak, suddenDeath, royale }));
    this.effects.clear();
    this.accumulator = 0;
    this.hitstop = 0;
    this.timeSinceEnd = 0;
  }

  // Starts (or resumes) this game's own animation-frame loop. Display screens
  // that aren't on the grid call stop() so they don't simulate and draw unseen.
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = null; // don't count the time spent stopped as one frame
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  // For an arena that's being removed: stops the loop and lets go of the canvas.
  destroy() {
    this.stop();
    this.renderer.destroy();
  }

  frame = (now) => {
    this.frameRequest = null;
    try {
      // Every Game reports its frame stamps; the quality controller keeps one
      // page-wide picture and scales effects and resolution down when frames slip.
      Quality.observeFrame(now);
      this.applyQuality();

      // Clamp so switching tabs doesn't cause a huge catch-up jump.
      const realDt = this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      if (!this.paused) {
        if (this.clock) this.followClock(realDt);
        else this.advance(realDt * this.timeScale);
      }

      this.renderer.draw(this.sim, this.effects, {
        showHitboxes: this.showHitboxes,
        paused: this.paused,
        endHint: this.endHint,
        follow: this.follow === null ? null : (this.sim?.balls[this.follow] ?? null),
        zoomed: this.zoomed,
        countdown: this.startsIn?.() ?? 0,
      });
    } finally {
      // Reschedule even if this frame threw, so one bad frame can't freeze the
      // arena (and leave start() early-returning on a stale `running`). The
      // pending check keeps stop()/start() during a frame from leaving an
      // orphaned second loop behind.
      if (this.running && this.frameRequest === null) this.frameRequest = requestAnimationFrame(this.frame);
    }
  };

  // Applies the page-wide quality profile after a level change: fewer sparks
  // and, at the lower levels, a smaller backing store for this arena. Both are
  // presentation-only, and both are restored when frames are comfortable again.
  applyQuality() {
    if (Quality.level === this.qualityLevel) return;
    this.qualityLevel = Quality.level;
    const { particleBudget, effectScale, resolutionScale } = Quality.profile;
    this.effects.setProfile({ budget: particleBudget, scale: effectScale });
    this.renderer.setResolutionScale(resolutionScale);
  }

  advance(dt) {
    this.effects.update(dt);
    if (!this.sim) return;

    if (this.sim.over) {
      this.timeSinceEnd += dt;
      if (this.autoRematch && this.timeSinceEnd > AUTO_REMATCH_DELAY) {
        this.newMatch();
        return;
      }
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < MAX_STEPS_PER_FRAME) {
      this.stepSim();
      this.accumulator -= this.fixedDt;
      steps++;
      // A hit just froze time; drop the rest of this frame's steps.
      if (this.hitstop > 0) {
        this.accumulator = 0;
        break;
      }
    }
  }

  // Plays to a shared clock instead of this page's own time, so every device
  // showing the match is at the same moment. A device that fell behind (it slept,
  // or opened the page late) catches up quietly, a few steps a frame. Hitstop is
  // left out here: it stops sim time, which a clock can't, so a shared 1v1 plays
  // without the freeze on hits (the sparks, shake and sound stay).
  followClock(dt) {
    this.effects.update(dt);
    if (!this.sim) return;
    const target = this.clock();
    this.catchingUp = target - this.sim.time > CATCH_UP_AFTER;
    const deadline = performance.now() + CATCH_UP_BUDGET;
    while (this.sim.time + this.fixedDt <= target) {
      this.stepSim();
      if (performance.now() > deadline) break;
    }
    this.catchingUp = false;
  }

  stepSim() {
    this.runSim(() => {
      this.sim.step(this.fixedDt);
      // endOnTime may flip a seeded coin for the tiebreak, so it runs in here too.
      const { timeLimit } = this.match;
      if (timeLimit && !this.sim.over && this.sim.time >= timeLimit) this.sim.endOnTime();
    });
  }

  // Ends the match now, as if its time limit ran out (so the HP tiebreak applies).
  endMatch() {
    if (!this.sim || this.sim.over) return;
    this.runSim(() => this.sim.endOnTime());
  }

  // Everything that can change how the match plays out goes through here.
  runSim(fn) {
    const run = () => this.withRandom(this.random, fn);
    return this.match?.exactMath ? withExactMath(run) : run();
  }

  // The sim runs with the match's seeded Math.random. Effects and sounds swap
  // the real one back in, so they don't use up the seeded sequence and change
  // how the match plays out.
  withRandom(random, fn) {
    const previous = Math.random;
    Math.random = random;
    try {
      return fn();
    } finally {
      Math.random = previous;
    }
  }

  handleSimEvent(type, data) {
    // Fast-forwarding to a shared clock: nothing to see or hear but the ending.
    if (this.catchingUp && type !== 'end') return;
    // A royale has hits and kills every step: hitstop and shake would never
    // stop, and damage numbers would bury the arena. Sparks stay, and growth shows.
    if (this.sim.royale) {
      this.handleRoyaleEvent(type, data);
      return;
    }
    const { effects, sound } = this;
    const hs = CONFIG.hitstop;

    switch (type) {
      case 'hit': {
        const { attacker, target, damage, crit, point } = data;
        sound.hit(damage, attacker.weapon.constructor.id);
        effects.burst(point, target.color, { count: 8 + Math.min(damage, 20) });
        effects.floatingText(
          { x: target.pos.x, y: target.pos.y - target.radius - 12 },
          crit ? `CRIT -${formatNumber(damage)}` : `-${formatNumber(damage)}`,
          crit ? '#ffd23f' : '#ffffff',
        );
        effects.shake(2 + damage * 0.4);
        this.hitstop = Math.max(this.hitstop, Math.min(hs.max, hs.base + hs.perDamage * damage));
        if (crit) {
          sound.crit();
          effects.burst(point, '#ffd23f', { count: 26, speed: 420, life: 0.5, size: 3.5 });
          effects.shake(8);
          this.hitstop = Math.max(this.hitstop, hs.crit);
        }
        break;
      }
      case 'dodge': {
        const { target, quiet } = data;
        if (quiet) break;
        sound.dodge();
        effects.floatingText({ x: target.pos.x, y: target.pos.y - target.radius - 12 }, 'DODGE', '#9fd3ff');
        break;
      }
      case 'damage': {
        const { target, damage, crit, quiet, color = '#ffffff' } = data;
        // Many small ticks (Pyromancer's ring): a spark each, no number or sound.
        if (quiet) {
          effects.burst(target.pos, color, { count: 1, speed: 120, life: 0.25, size: 2 });
          break;
        }
        sound.chip();
        effects.burst(target.pos, color, { count: 6, speed: 160, life: 0.3, size: 2 });
        const text = crit ? `CRIT -${formatNumber(damage)}` : `-${formatNumber(damage)}`;
        effects.floatingText({ x: target.pos.x, y: target.pos.y - target.radius - 12 }, text, crit ? '#ffd23f' : color);
        break;
      }
      case 'block':
      case 'parry':
        if (type === 'block') sound.block();
        else sound.parry();
        effects.burst(data.point, '#ffd966', { count: 14, speed: 320, life: 0.3, size: 2.5 });
        effects.shake(2);
        this.hitstop = Math.max(this.hitstop, hs.parry);
        break;
      case 'ability': {
        const { ball, phase, shake, burst, hitstop, text, color, pos = ball.pos } = data;
        sound.ability(phase, shake);
        if (shake) effects.shake(shake);
        if (hitstop) this.hitstop = Math.max(this.hitstop, hitstop);
        if (burst) effects.burst(pos, burst.color ?? ball.color, burst);
        if (text) effects.floatingText({ x: pos.x, y: pos.y - ball.radius - 12 }, text, color ?? '#ffffff');
        break;
      }
      case 'upgrade': {
        const { ball, phase, shake, burst, text, color, pos = ball.pos } = data;
        sound.upgrade(phase, shake);
        if (shake) effects.shake(shake);
        if (burst) effects.burst(pos, burst.color ?? ball.color, burst);
        if (text) effects.floatingText({ x: pos.x, y: pos.y - ball.radius - 12 }, text, color ?? '#ffffff');
        break;
      }
      case 'death':
        effects.burst(data.ball.pos, data.ball.color, { count: 70, speed: 450, life: 0.9, size: 4 });
        effects.shake(14);
        sound.death();
        break;
      case 'end':
        sound.end(data.winner !== null);
        this.onMatchEnd(this.sim);
        break;
    }
  }

  // Effects for a royale (see handleSimEvent): sparks sized to the balls
  // involved, a flash of the killer's colour when it grows, and no hitstop.
  handleRoyaleEvent(type, data) {
    const { effects, sound } = this;
    switch (type) {
      case 'hit': {
        const { attacker, target, damage, crit, point } = data;
        sound.hit(damage, attacker.weapon.constructor.id);
        effects.burst(point, crit ? '#ffd23f' : target.color, { count: 6, size: 3 * target.size, speed: 220 * target.size });
        if (crit) sound.crit();
        break;
      }
      case 'damage': {
        const { target, color = '#ffffff' } = data;
        effects.burst(target.pos, color, { count: 3, speed: 160 * target.size, life: 0.3, size: 2 * target.size });
        break;
      }
      case 'block':
      case 'parry':
        if (type === 'block') sound.block();
        else sound.parry();
        effects.burst(data.point, '#ffd966', { count: 6, speed: 320, life: 0.3, size: 2.5 });
        break;
      case 'ability':
      case 'upgrade': {
        const { ball, phase, burst, pos = ball.pos } = data;
        if (type === 'ability') sound.ability(phase, 0);
        else sound.upgrade(phase, 0);
        if (burst) effects.burst(pos, burst.color ?? ball.color, burst);
        break;
      }
      case 'death': {
        const { ball } = data;
        effects.burst(ball.pos, ball.color, { count: 40, speed: 450 * ball.size, life: 0.8, size: 4 * ball.size });
        sound.death();
        break;
      }
      case 'grow': {
        const { ball } = data;
        effects.burst(ball.pos, ball.color, { count: 24, speed: 260 * ball.size, life: 0.5, size: 3 * ball.size });
        break;
      }
      case 'end':
        sound.end(data.winner !== null);
        effects.shake(10);
        this.onMatchEnd(this.sim);
        break;
    }
  }
}
