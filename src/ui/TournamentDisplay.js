const RESULT_PAUSE = 4000; // ms the winner stays on screen before the next match starts

// Display mode (open the game with `?display`): plays the matches queued
// through the match API (server/matches.js) and reports each result back.
// This page decides the official result, so what's on screen is what counts.
export class TournamentDisplay {
  constructor(game) {
    this.game = game;
    this.match = null; // the match on screen, or the last one played
    this.reported = false; // whether this.match has ended and its result was sent
    this.result = null;
    this.finishedAt = 0; // performance.now() when the last match ended
    this.timer = null;

    game.endHint = '';
    // EventSource reconnects by itself, and the server sends the current match
    // again on every connection.
    new EventSource('/api/display').onmessage = (e) => this.receive(JSON.parse(e.data));
  }

  // What Game plays: the current match, or null for an empty arena.
  get currentMatch() {
    return this.match && { fighters: this.match.fighters, seed: this.match.seed, timeLimit: this.match.timeLimit };
  }

  // The server's current match changed (or we just connected).
  receive(match) {
    clearTimeout(this.timer);
    if (match?.id === this.match?.id) {
      // Reconnected mid-match: keep playing. If the result never got through, send it again.
      if (this.reported) this.report();
      return;
    }
    if (!match) {
      // Queue is empty. If the match on screen was cancelled, clear it.
      if (this.match && !this.reported) this.show(null);
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
    if (match) post(`/api/matches/${match.id}/start`);
  }

  // Called by Game when the match on screen is decided.
  onMatchEnd(sim) {
    if (!this.match || this.reported) return; // e.g. a replay after pressing R
    this.reported = true;
    this.finishedAt = performance.now();
    this.result = {
      winner: sim.winner ? sim.balls.indexOf(sim.winner) : null,
      time: sim.time,
      hp: sim.balls.map((ball) => ball.hp),
    };
    this.report();
  }

  report() {
    post(`/api/matches/${this.match.id}/result`, this.result);
  }
}

function post(url, body) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    .then(async (res) => {
      if (!res.ok) console.warn(`${url}: ${(await res.json()).error}`);
    })
    .catch((err) => console.warn(`${url}: ${err.message}`));
}
