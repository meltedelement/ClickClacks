import { WEAPONS, getWeaponById } from '../weapons/index.js';

const RANDOM = 'random';

// Wires the menu (fighter pickers, sim settings) and keyboard shortcuts to the Game.
export class Controls {
  constructor(game, { fighters }) {
    this.game = game;

    this.buildFighterSelects(fighters);
    this.bindSettings();
    this.bindMenu();
    this.bindFullscreen();
    this.bindKeyboard();
  }

  // Weapons for the next match. Random slots are rerolled every match and avoid
  // weapons already in the fight, so random matchups aren't mirrors.
  get lineup() {
    const lineup = this.selects.map((select) => (select.value === RANDOM ? null : getWeaponById(select.value)));
    for (let i = 0; i < lineup.length; i++) {
      if (lineup[i]) continue;
      const unused = WEAPONS.filter((W) => !lineup.includes(W));
      lineup[i] = randomItem(unused.length > 0 ? unused : WEAPONS);
    }
    return lineup;
  }

  startMatch() {
    this.game.newMatch();
  }

  buildFighterSelects(fighters) {
    const root = byId('fighter-selects');
    this.selects = Array.from({ length: fighters }, (_, i) => {
      const label = el('label', 'field');
      label.append(el('span', 'field-label', `Fighter ${i + 1}`));

      const select = el('select');
      select.append(new Option('Random', RANDOM));
      for (const W of WEAPONS) select.append(new Option(W.displayName, W.id));
      select.value = RANDOM;
      select.addEventListener('change', () => {
        select.blur();
        this.startMatch();
      });

      label.append(select);
      root.append(label);
      return select;
    });
  }

  bindSettings() {
    const { game } = this;
    const speed = byId('speed');
    const speedValue = byId('speed-value');
    this.pauseButton = byId('pause');

    onClick('restart', () => this.startMatch());
    onClick('pause', () => this.togglePause());

    const applySpeed = () => {
      game.timeScale = Number(speed.value);
      speedValue.textContent = `${speed.value}×`;
    };
    speed.addEventListener('input', applySpeed);
    speed.addEventListener('change', () => speed.blur());
    applySpeed();

    this.hitboxToggle = bindCheckbox('hitboxes', (on) => (game.showHitboxes = on));
    bindCheckbox('auto-rematch', (on) => (game.autoRematch = on));
  }

  bindMenu() {
    this.menuToggle = byId('menu-toggle');
    this.menuPanel = byId('menu-panel');

    onClick('menu-toggle', () => this.setMenuOpen(this.menuPanel.hidden));

    // Clicking anywhere outside the menu closes it.
    document.addEventListener('pointerdown', (e) => {
      if (!this.menuPanel.hidden && !e.target.closest('.menu')) this.setMenuOpen(false);
    });
  }

  setMenuOpen(open) {
    this.menuPanel.hidden = !open;
    this.menuToggle.setAttribute('aria-expanded', String(open));
  }

  bindFullscreen() {
    const button = byId('fullscreen');
    if (!document.fullscreenEnabled) {
      button.hidden = true;
      return;
    }
    onClick('fullscreen', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      button.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    });
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePause();
          break;
        case 'KeyR':
          this.startMatch();
          break;
        case 'KeyH':
          this.hitboxToggle.checked = !this.hitboxToggle.checked;
          this.game.showHitboxes = this.hitboxToggle.checked;
          break;
        case 'KeyF':
          if (document.fullscreenEnabled) this.toggleFullscreen();
          break;
        case 'Escape':
          this.setMenuOpen(false);
          break;
      }
    });
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    this.pauseButton.textContent = this.game.paused ? 'Resume' : 'Pause';
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function byId(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Buttons drop focus after a click so Space goes to the game, not the button.
function onClick(id, fn) {
  byId(id).addEventListener('click', (e) => {
    e.currentTarget.blur();
    fn();
  });
}

function bindCheckbox(id, onChange) {
  const box = byId(id);
  box.addEventListener('change', () => {
    box.blur();
    onChange(box.checked);
  });
  onChange(box.checked);
  return box;
}
