import './styles.css';
import { Game } from './game/Game.js';
import { Controls } from './ui/Controls.js';

const game = new Game(document.getElementById('arena'));
const controls = new Controls(game, { defaultLineup: ['sword', 'spear'] });

controls.startMatch();
game.start();
