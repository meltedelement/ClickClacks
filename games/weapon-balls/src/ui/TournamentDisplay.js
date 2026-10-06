import { Game } from '../game/Game.js';

const RESULT_PAUSE = 4000; // ms a winner stays on its screen before the next match there starts
const MAX_SCREENS = 4; // a 2×2 grid; the server's SCREENS setting is at most this

// Display mode (open the game with `?display`): plays the matches queued
// through the match API (server/matches.js) and reports each result back.
// This page decides the official result, so what's on screen is what counts.
//
// The server puts up to four matches on screens at once. Each screen has its
// own Game and its own mute button (keys 1 to 4 do the same). The grid shows as
// many screens as are in use: it grows as soon as a match needs another
// screen, and shrinks only when a new set of matches starts after every screen
// has finished, so a finished match's banner never jumps to another place.
export class TournamentDisplay {
  constructor(stage) {
    this.grid = el('div', 'screens');
    stage.replaceChildren(this.grid);
    this.screens = Array.from({ length: MAX_SCREENS }, (_, i) => new Screen(this.grid, i));
    this.visible = 1;
    this.layout();

    window.addEventListener('keydown', (e) => {
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0 && i < this.visible) this.screens[i].toggleMute();
    });

    // EventSource reconnects by itself, and the server sends every screen again
    // on each connection.
    new EventSource('/api/display').onmessage = (e) => this.receive(JSON.parse(e.data).screens);
  }

  // Every screen's Game, for the menu's pause, speed and hitbox settings.
  get games() {
    return this.screens.map((screen) => screen.game);
  }

  // The server's screens changed (or we just connected): the match on each screen, or null.
  receive(matches) {
    const needed = matches.findLastIndex(Boolean) + 1;
    const idle = this.screens.slice(0, this.visible).every((screen) => !screen.live);
    if (needed > this.visible || (idle && needed > 0)) {
      this.visible = needed;
      this.layout();
    }
    this.screens.forEach((screen, i) => screen.receive(matches[i] ?? null));
  }

  layout() {
    this.grid.dataset.count = String(this.visible);
    this.screens.forEach((screen, i) => {
      screen.cell.hidden = i >= this.visible;
      // Off-grid screens have no match (the server only fills the first
      // `visible` slots), so don't simulate and draw them: with four screens
      // built and one in use that is three wasted animation frames a frame.
      screen.setRunning(i < this.visible);
    });
  }
}

// One arena on the display page and the match the server put on it.
class Screen {
  constructor(parent, index) {
    this.index = index;
    this.match = null; // the match on this screen, or the last one played
    this.reported = false; // whether this.match has ended and its result was sent
    this.result = null;
    this.finishedAt = 0; // performance.now() when the last match ended
    this.timer = null;
    this.running = false;

    this.cell = el('div', 'screen');
    const canvas = el('canvas');
    this.muteButton = el('button', 'screen-mute');
    this.muteButton.type = 'button';
    this.muteButton.addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.toggleMute();
    });
    this.endButton = el('button', 'screen-end');
    this.endButton.type = 'button';
    this.endButton.textContent = 'End';
    this.endButton.title = `End the match on screen ${index + 1} (decided on HP if it has the tiebreak)`;
    this.endButton.hidden = true;
    this.endButton.addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.game.endMatch();
    });
    this.cell.append(canvas, this.muteButton, this.endButton);
    parent.append(this.cell);

    this.game = new Game(canvas, {
      chooseMatch: () => this.currentMatch,
      onMatchEnd: (sim) => this.onMatchEnd(sim),
      soundKey: `screen-${index + 1}`,
    });
    this.game.endHint = '';
    this.game.newMatch();
    this.renderMute();
  }

  // Only on-grid screens run (see TournamentDisplay.layout).
  setRunning(running) {
    if (running === this.running) return;
    this.running = running;
    if (running) {
      // The cell was hidden, so the canvas is still at its hidden size (1x1).
      // Re-measure now rather than after a frame, so the arena comes back sharp.
      this.game.renderer.resize();
      this.game.start();
    } else {
      this.game.stop();
    }
  }

  // True while a match plays here and its result has not been sent.
  get live() {
    return Boolean(this.match) && !this.reported;
  }

  // What Game plays: the match on this screen, or null for an empty arena. The
  // API keeps transformations apart from upgrades; the sim takes them in one
  // list and applies transformations first.
  get currentMatch() {
    const { match } = this;
    if (!match) return null;
    const fighters = match.characters.map(({ transformations = [], upgrades = [], ...fighter }) => ({ ...fighter, upgrades: [...transformations, ...upgrades] }));
    return { fighters, seed: match.seed, timeLimit: match.timeLimit, tiebreak: match.tiebreak, suddenDeath: match.suddenDeath };
  }

  toggleMute() {
    this.game.sound.muted = !this.game.sound.muted;
    this.renderMute();
  }

  renderMute() {
    const muted = this.game.sound.muted;
    const label = `${muted ? 'Unmute' : 'Mute'} screen ${this.index + 1} (key ${this.index + 1})`;
    this.muteButton.setAttribute('aria-label', label);
    this.muteButton.title = label;
    this.muteButton.classList.toggle('muted', muted);
    this.muteButton.innerHTML = speakerIcon(muted);
  }

  // The server's match for this screen changed (or we just connected).
  receive(match) {
    clearTimeout(this.timer);
    if (match?.id === this.match?.id) {
      // Reconnected mid-match: keep playing. If the result never got through, send it again.
      if (this.reported) this.report();
      return;
    }
    if (!match) {
      // Nothing for this screen. If the match on it was cancelled, clear it.
      if (this.live) this.show(null);
      return;
    }
    // Let the last winner banner stay up for a moment, unless that match was cancelled.
    const wait = this.reported ? this.finishedAt + RESULT_PAUSE - performance.now() : 0;
    this.timer = setTimeout(() => this.show(match), Math.max(0, wait));
  }

  show(match) {
    this.match = match;
    this.reported = false;
    this.game.newMatch();
    this.endButton.hidden = !match;
    if (match) post(`/api/matches/${match.id}/start`);
  }

  // Called by Game when the match on this screen is decided.
  onMatchEnd(sim) {
    if (!this.match || this.reported) return; // e.g. a replay after pressing R
    this.reported = true;
    this.endButton.hidden = true;
    this.finishedAt = performance.now();
    this.result = {
      winner: sim.winner ? sim.balls.indexOf(sim.winner) : null,
      decidedBy: sim.decidedBy ?? 'ko',
      time: sim.time,
      hp: sim.balls.map((ball) => ball.hp),
      ranking: sim.ranking,
    };
    this.report();
  }

  report() {
    post(`/api/matches/${this.match.id}/result`, this.result);
  }
}

function speakerIcon(muted) {
  const waves = muted ? '<path d="M16 9l5 6M21 9l-5 6" />' : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />${waves}</svg>`;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function post(url, body) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    .then(async (res) => {
      if (!res.ok) console.warn(`${url}: ${(await res.json()).error}`);
    })
    .catch((err) => console.warn(`${url}: ${err.message}`));
}
