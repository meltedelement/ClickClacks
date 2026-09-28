import { CONFIG } from '../config.js';
import { Simulation } from '../sim/Simulation.js';
import { formatNumber } from '../utils/format.js';
import { Effects } from './Effects.js';
import { Renderer } from './Renderer.js';
import { Sound } from './Sound.js';

const AUTO_REMATCH_DELAY = 2.5; // seconds after a win
const MAX_STEPS_PER_FRAME = 40;

// Owns the browser loop: runs the simulation at a fixed rate, turns sim events
// into effects, handles pause / speed / hitstop, and draws each frame.
export class Game {
  // chooseLineup() returns the weapon classes for each new match.
  constructor(canvas, { chooseLineup }) {
    this.chooseLineup = chooseLineup;
    this.renderer = new Renderer(canvas);
    this.effects = new Effects();
    this.sound = new Sound();
    this.fixedDt = 1 / CONFIG.physicsHz;

    // Settings the UI can change.
    this.timeScale = 1;
    this.paused = false;
    this.showHitboxes = false;
    this.autoRematch = false;

    this.sim = null;
    this.accumulator = 0;
    this.hitstop = 0;
    this.timeSinceEnd = 0;
    this.lastTime = null;
  }

  newMatch() {
    this.sim = new Simulation(this.chooseLineup(), { onEvent: (type, data) => this.handleSimEvent(type, data) });
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

    this.renderer.draw(this.sim, this.effects, { showHitboxes: this.showHitboxes, paused: this.paused });
    requestAnimationFrame(this.frame);
  };

  advance(dt) {
    this.effects.update(dt);

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
      this.sim.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
      // A hit just froze time; drop the rest of this frame's steps.
      if (this.hitstop > 0) {
        this.accumulator = 0;
        break;
      }
    }
  }

  handleSimEvent(type, data) {
    const { effects, sound } = this;
    const hs = CONFIG.hitstop;

    switch (type) {
      case 'hit': {
        const { attacker, target, damage, point } = data;
        sound.hit(damage, attacker.weapon.constructor.id);
        effects.burst(point, target.color, { count: 8 + Math.min(damage, 20) });
        effects.floatingText(
          { x: target.pos.x, y: target.pos.y - target.radius - 12 },
          `-${formatNumber(damage)}`,
          '#ffffff',
        );
        effects.shake(2 + damage * 0.4);
        this.hitstop = Math.max(this.hitstop, Math.min(hs.max, hs.base + hs.perDamage * damage));
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
      case 'death':
        effects.burst(data.ball.pos, data.ball.color, { count: 70, speed: 450, life: 0.9, size: 4 });
        effects.shake(14);
        sound.death();
        break;
      case 'end':
        sound.end(data.winner !== null);
        break;
    }
  }
}
