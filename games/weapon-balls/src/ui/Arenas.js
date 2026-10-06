import { Game } from '../game/Game.js';

const GUTTER = 12; // px, about var(--gutter); only used to pick the grid shape

// The main page's arenas: one or more Games side by side, each playing its own
// match. chooseMatch is asked once per arena, so random fighters and random
// upgrades are rolled separately for each. The menu's settings apply to all
// of them (see Controls). The grid takes whichever shape gives the biggest
// arenas on this window.
export class Arenas {
  constructor(stage, { chooseMatch }) {
    this.chooseMatch = chooseMatch;
    this.grid = el('div', 'screens');
    stage.replaceChildren(this.grid);
    this.games = []; // Controls holds on to this array, so it's changed in place
    this.cells = [];
    window.addEventListener('resize', () => this.layout());
  }

  // Adds or removes arenas at the end; the others carry on with their match.
  // Returns the games added: they have no match yet and aren't running.
  setCount(n) {
    const added = [];
    while (this.games.length < n) {
      const cell = el('div', 'screen');
      const canvas = el('canvas');
      cell.append(canvas);
      this.grid.append(cell);
      const game = new Game(canvas, { chooseMatch: this.chooseMatch });
      this.cells.push(cell);
      this.games.push(game);
      added.push(game);
    }
    while (this.games.length > n) {
      this.games.pop().destroy();
      this.cells.pop().remove();
    }
    this.layout();
    return added;
  }

  // Picks the column count that gives the largest square cells, then lets the
  // .screens grid size them.
  layout() {
    const n = this.games.length;
    const { innerWidth: width, innerHeight: height } = window;
    let best = { cols: 1, rows: n, cell: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cell = Math.min((width - (cols + 1) * GUTTER) / cols, (height - (rows + 1) * GUTTER) / rows);
      if (cell > best.cell) best = { cols, rows, cell };
    }
    this.grid.style.setProperty('--cols', String(best.cols));
    this.grid.style.setProperty('--rows', String(best.rows));
  }
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
