import './styles.css';
import { Game } from './game/Game.js';
import { Quality } from './game/Quality.js';
import { Controls } from './ui/Controls.js';
import { TournamentDisplay } from './ui/TournamentDisplay.js';

const params = new URLSearchParams(location.search);

// Quality adapts to the frame rate by itself (see src/game/Quality.js).
// `?quality=high|medium|low|minimal` pins a level instead, for a machine whose
// frame rate is already known (e.g. the display at a venue).
const QUALITY_LEVELS = { high: 0, medium: 1, low: 2, minimal: 3 };
const requestedQuality = params.get('quality');
if (requestedQuality !== null && Object.hasOwn(QUALITY_LEVELS, requestedQuality)) {
  Quality.enabled = false;
  Quality.level = QUALITY_LEVELS[requestedQuality];
}

// `?display` turns the page into a tournament screen that plays matches queued
// through the match API (server/matches.js) instead of the menu's matchup.
const displayMode = params.has('display');

if (displayMode) {
  const display = new TournamentDisplay(document.querySelector('.stage'));
  new Controls(display.games, { fighters: 2, displayMode });
} else {
  const game = new Game(document.getElementById('arena'), {
    chooseMatch: () => ({ fighters: controls.lineup }),
  });
  const controls = new Controls([game], { fighters: 2 });
  controls.startMatch();
  game.start();
}
