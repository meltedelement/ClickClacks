import { Game } from '../game/Game.js';

const RESULT_PAUSE = 4000; // ms a winner stays on its screen before the next match there starts
const MAX_SCREENS = 4; // a 2×2 grid; the server's SCREENS setting is at most this
const SILENCE_LIMIT = 40_000; // ms without a message (the server sends one every 15 s) before reconnecting

// Display mode (open the game with `?display`): plays the matches queued
// through the match API (server/matches.js) and reports each result back.
// This page decides the official result, so what's on screen is what counts.
//
// The server puts up to four matches on screens at once. Each screen has its
// own Game and its own mute button (keys 1 to 4 do the same). The grid shows as
// many screens as are in use: it grows as soon as a match needs another
// screen, and shrinks only when a new set of matches starts after every screen
// has finished, so a finished match's banner never jumps to another place.
//
// A shared match (every royale, and 1v1s queued with `settings.shared`) plays to
// the server's clock, measured from when it started, and with math that's the
// same in every browser. So any number of devices can show the
// same fight at the same moment, and one that opens late or wakes up catches up.
// `follow` is the slot of a fighter to keep the first screen's view on (`&follow=3`),
// for someone watching their own ball; tapping the arena zooms out and back.
export class TournamentDisplay {
  constructor(stage, { follow = null } = {}) {
    this.grid = el('div', 'screens');
    stage.replaceChildren(this.grid);
    this.clockOffset = -Infinity; // the server's clock minus this device's, in ms
    const serverNow = () => Date.now() + this.clockOffset;
    this.screens = Array.from({ length: MAX_SCREENS }, (_, i) => new Screen(this.grid, i, serverNow, i === 0 ? follow : null));
    this.visible = 1;
    this.layout();

    window.addEventListener('keydown', (e) => {
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0 && i < this.visible) this.screens[i].toggleMute();
    });

    // EventSource reconnects by itself, and the server sends every screen again
    // on each connection. The URLs here are relative so that this page also
    // works from under a path, behind a program that proxies it.
    this.connect();
  }

  // EventSource reconnects by itself only when the connection closes. One that
  // dies without closing (a phone's Wi-Fi napping, a proxy dropping it) just goes
  // quiet, and a device that misses a shared match's start sits at its first
  // frame. The server sends a `clock` event every 15 s, so silence means a dead
  // stream: open a new one, which sends every screen again.
  connect() {
    this.events?.close();
    const events = new EventSource('api/display');
    this.events = events;
    let watchdog;
    const heard = (now) => {
      // A message arrives late, never early, so the largest reading is the truest.
      this.clockOffset = Math.max(this.clockOffset, now - Date.now());
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (this.events === events) this.connect();
      }, SILENCE_LIMIT);
    };
    heard(-Infinity);
    events.onmessage = (e) => {
      const { screens, now } = JSON.parse(e.data);
      heard(now);
      this.receive(screens);
    };
    events.addEventListener('clock', (e) => heard(JSON.parse(e.data).now));
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
  constructor(parent, index, serverNow, follow) {
    this.index = index;
    this.serverNow = serverNow;
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
    if (follow !== null) {
      this.game.follow = follow;
      this.game.zoomed = true;
      canvas.addEventListener('click', () => {
        this.game.zoomed = !this.game.zoomed;
      });
    }
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
    const { royale, shared } = match;
    return { fighters, seed: match.seed, timeLimit: match.timeLimit, tiebreak: match.tiebreak, suddenDeath: match.suddenDeath, royale, exactMath: shared };
  }

  // Sim seconds into this shared match by the server's clock. 0 until the server has it started.
  get elapsed() {
    const startedAt = this.match?.startedAt;
    return startedAt ? Math.max(0, (this.serverNow() - Date.parse(startedAt)) / 1000) : 0;
  }

  // Seconds until this shared match's clock starts (it starts a little after
  // it's put up, see the server's startDelay), or 0 once it's running. Until the
  // server has it started, the whole delay.
  get startsIn() {
    const { match } = this;
    if (!match) return 0;
    if (!match.startedAt) return match.startDelay ?? 0;
    return Math.max(0, (Date.parse(match.startedAt) - this.serverNow()) / 1000);
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
    if (match && match.id === this.match?.id) {
      // Reconnected mid-match, or it just started: keep playing. If the result
      // never got through, send it again.
      this.match = match;
      if (this.reported) this.report();
      return;
    }
    if (!match) {
      // Nothing for this screen. If the match on it was cancelled, clear it. A
      // shared match may just have been finished by another device a moment ahead
      // of this one, so it plays out to its own ending here.
      if (this.live && !this.match.shared) this.show(null);
      return;
    }
    // Let the last winner banner stay up for a moment, unless that match was cancelled.
    const wait = this.reported ? this.finishedAt + RESULT_PAUSE - performance.now() : 0;
    this.timer = setTimeout(() => this.show(match), Math.max(0, wait));
  }

  show(match) {
    this.match = match;
    this.reported = false;
    this.game.clock = match?.shared ? () => this.elapsed : null;
    this.game.startsIn = match?.shared ? () => this.startsIn : null;
    this.game.newMatch();
    // A shared match runs to a clock that everyone shares, so nobody can end it early.
    this.endButton.hidden = !match || match.shared;
    if (!match) return;
    // The reply has the match's start time. Take it from there too, not only from
    // the event stream's broadcast, so a device that misses that broadcast still
    // starts the clock instead of waiting at its first frame.
    post(`api/matches/${match.id}/start`).then((started) => {
      if (started?.id === this.match?.id && started.startedAt && !this.match.startedAt) this.match.startedAt = started.startedAt;
    });
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
    post(`api/matches/${this.match.id}/result`, this.result);
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

// Resolves to the server's reply, or null when the request failed.
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    .then(async (res) => {
      const reply = await res.json();
      if (res.ok) return reply;
      console.warn(`${url}: ${reply.error}`);
      return null;
    })
    .catch((err) => {
      console.warn(`${url}: ${err.message}`);
      return null;
    });
}
