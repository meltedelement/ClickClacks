import './styles.css';
import { Game } from './game/Game.js';
import { Controls } from './ui/Controls.js';
import { TournamentDisplay } from './ui/TournamentDisplay.js';

// `?display` turns the page into a tournament screen that plays matches queued
// through the match API (server/matches.js) instead of the menu's matchup.
const displayMode = new URLSearchParams(location.search).has('display');

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
