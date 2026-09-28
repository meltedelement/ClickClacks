import './styles.css';
import { Game } from './game/Game.js';
import { Controls } from './ui/Controls.js';

const game = new Game(document.getElementById('arena'), { chooseLineup: () => controls.lineup });
const controls = new Controls(game, { fighters: 2 });

controls.startMatch();
game.start();
