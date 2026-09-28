import './styles.css';
import { Game } from './game/Game.js';
import { Controls } from './ui/Controls.js';
import { TournamentDisplay } from './ui/TournamentDisplay.js';

// `?display` turns the page into a tournament screen that plays matches queued
// through the match API (server/matches.js) instead of the menu's matchup.
const displayMode = new URLSearchParams(location.search).has('display');

const game = new Game(document.getElementById('arena'), {
  chooseMatch: () => (displayMode ? display.currentMatch : { fighters: controls.lineup }),
  onMatchEnd: (sim) => display?.onMatchEnd(sim),
});
const controls = new Controls(game, { fighters: 2, displayMode });
const display = displayMode ? new TournamentDisplay(game) : null;

controls.startMatch();
game.start();
