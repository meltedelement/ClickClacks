import { CONFIG } from '../config.js';
import { Simulation } from '../sim/Simulation.js';
import { mulberry32 } from '../sim/random.js';
import { formatNumber } from '../utils/format.js';
import { Effects } from './Effects.js';
import { Renderer } from './Renderer.js';
import { Sound } from './Sound.js';

const AUTO_REMATCH_DELAY = 2.5; // seconds after a win
const MAX_STEPS_PER_FRAME = 40;
const realRandom = Math.random;

// Owns the browser loop: runs the simulation at a fixed rate, turns sim events
// into effects, handles pause / speed / hitstop, and draws each frame.
export class Game {
  // chooseMatch() returns the next match to play, or null to show an empty
  // arena: { fighters, seed?, timeLimit?, tiebreak? }, where fighters are
  // loadouts (see Simulation). A seeded match plays out the same way every
  // time. A match still going at timeLimit (in sim seconds) is a draw, or with
  // tiebreak 'hp' goes to the fighter with the most HP left. onMatchEnd(sim) is
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

    this.match = null;
    this.sim = null;
    this.random = realRandom; // what Math.random is while the sim runs
    this.accumulator = 0;
    this.hitstop = 0;
    this.timeSinceEnd = 0;
    this.lastTime = null;
  }

  newMatch() {
    this.match = this.chooseMatch();
    this.random = this.match?.seed == null ? realRandom : mulberry32(this.match.seed);
    const onEvent = (type, data) => this.withRandom(realRandom, () => this.handleSimEvent(type, data));
    const { fighters, tiebreak } = this.match ?? {};
    this.sim = this.match && this.withRandom(this.random, () => new Simulation(fighters, { onEvent, tiebreak }));
    this.effects.clear();
    this.accumulator = 0;
    this.hitstop = 0;
    this.timeSinceEnd = 0;
  }

  start() {
    requestAnimationFrame(this.frame);
  }

  frame = (now) => {
    // Clamp so switching tabs doesn't cause a huge catch-up jump.
    const realDt = this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (!this.paused) this.advance(realDt * this.timeScale);

    this.renderer.draw(this.sim, this.effects, { showHitboxes: this.showHitboxes, paused: this.paused, endHint: this.endHint });
    requestAnimationFrame(this.frame);
  };

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

  stepSim() {
    this.withRandom(this.random, () => {
      this.sim.step(this.fixedDt);
      // endOnTime may flip a seeded coin for the tiebreak, so it runs in here too.
      const { timeLimit } = this.match;
      if (timeLimit && !this.sim.over && this.sim.time >= timeLimit) this.sim.endOnTime();
    });
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
        const { target } = data;
        sound.dodge();
        effects.floatingText({ x: target.pos.x, y: target.pos.y - target.radius - 12 }, 'DODGE', '#9fd3ff');
        break;
      }
      case 'damage': {
        const { target, damage, color = '#ffffff' } = data;
        sound.chip();
        effects.burst(target.pos, color, { count: 6, speed: 160, life: 0.3, size: 2 });
        effects.floatingText({ x: target.pos.x, y: target.pos.y - target.radius - 12 }, `-${formatNumber(damage)}`, color);
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
        const { ball, phase, shake, burst } = data;
        sound.ability(phase, shake);
        if (shake) effects.shake(shake);
        if (burst) effects.burst(ball.pos, burst.color ?? ball.color, burst);
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
}
