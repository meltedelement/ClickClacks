import { WEAPONS, getWeaponById } from '../weapons/index.js';
import { getUpgradeById, upgradesFor } from '../upgrades/index.js';
import { Sound } from '../game/Sound.js';

const RANDOM = 'random';

// Wires the menu (fighter pickers, sim settings) and keyboard shortcuts to the
// games: one normally, one per screen in display mode. Settings apply to all.
export class Controls {
  // In display mode the match API picks the matchups, so the matchup section
  // and auto rematch are hidden.
  constructor(games, { fighters, displayMode = false }) {
    this.games = games;
    this.paused = false;

    this.buildFighterSelects(fighters);
    this.bindSettings();
    if (displayMode) {
      byId('matchup').hidden = true;
      byId('auto-rematch').closest('label').hidden = true;
    }
    this.bindMenu();
    this.bindFullscreen();
    this.bindKeyboard();
  }

  // Loadouts for the next match. Random slots are rerolled every match and avoid
  // weapons already in the fight, so random matchups aren't mirrors.
  get lineup() {
    const weapons = this.selects.map((select) => (select.value === RANDOM ? null : getWeaponById(select.value)));
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i]) continue;
      const unused = WEAPONS.filter((W) => !weapons.includes(W));
      weapons[i] = randomItem(unused.length > 0 ? unused : WEAPONS);
    }
    return weapons.map((W, i) => ({ weapon: W.id, upgrades: [...this.fighterUpgrades[i]] }));
  }

  startMatch() {
    for (const game of this.games) game.newMatch();
  }

  // Sets a property on every game.
  setAll(key, value) {
    for (const game of this.games) game[key] = value;
  }

  buildFighterSelects(fighters) {
    const root = byId('fighter-selects');
    // Upgrade ids per fighter, in the order added; a repeated id is a stack.
    this.fighterUpgrades = Array.from({ length: fighters }, () => []);
    this.upgradeLists = [];
    this.upgradeAdders = [];

    this.selects = Array.from({ length: fighters }, (_, i) => {
      const fighter = el('div', 'fighter');
      const label = el('label', 'field');
      label.append(el('span', 'field-label', `Fighter ${i + 1}`));

      const select = el('select');
      select.append(new Option('Random', RANDOM));
      for (const W of WEAPONS) select.append(new Option(W.displayName, W.id));
      select.value = RANDOM;
      select.addEventListener('change', () => {
        select.blur();
        this.pruneUpgrades(i);
        this.renderUpgrades(i);
        this.startMatch();
      });
      label.append(select);

      const list = el('ul', 'upgrade-list');
      const adder = el('select', 'upgrade-add');
      adder.addEventListener('change', () => {
        const id = adder.value;
        adder.blur();
        if (!id) return;
        this.changeUpgrade(i, id, +1);
      });

      fighter.append(label, list, adder);
      root.append(fighter);
      this.upgradeLists.push(list);
      this.upgradeAdders.push(adder);
      return select;
    });

    for (let i = 0; i < fighters; i++) this.renderUpgrades(i);
  }

  // Weapon id whose upgrades fighter `i` can take. For Random that's null,
  // which only upgrades that fit every weapon accept.
  upgradeWeaponId(i) {
    const value = this.selects[i].value;
    return value === RANDOM ? null : value;
  }

  // Adds (+1) or removes (-1) one copy of an upgrade, then restarts the match.
  changeUpgrade(i, id, delta) {
    const owned = this.fighterUpgrades[i];
    if (delta > 0) {
      const addable = upgradesFor(this.upgradeWeaponId(i), owned).some((U) => U.id === id);
      if (!addable) return;
      owned.push(id);
    } else {
      const at = owned.lastIndexOf(id);
      if (at < 0) return;
      owned.splice(at, 1);
    }
    this.pruneUpgrades(i);
    this.renderUpgrades(i);
    this.startMatch();
  }

  // Drops upgrades that no longer fit the fighter's weapon, then any whose
  // requirements were removed (repeatedly, in case requirements chain).
  pruneUpgrades(i) {
    const weaponId = this.upgradeWeaponId(i);
    let owned = this.fighterUpgrades[i].filter((id) => getUpgradeById(id).canApplyTo(weaponId));
    let changed = true;
    while (changed) {
      const kept = owned.filter((id) => getUpgradeById(id).requires.every((req) => owned.includes(req)));
      changed = kept.length !== owned.length;
      owned = kept;
    }
    this.fighterUpgrades[i] = owned;
  }

  renderUpgrades(i) {
    const owned = this.fighterUpgrades[i];
    const list = this.upgradeLists[i];
    list.replaceChildren();

    for (const id of new Set(owned)) {
      const U = getUpgradeById(id);
      const count = owned.filter((x) => x === id).length;
      const item = el('li', 'upgrade');
      item.title = U.description;
      item.append(el('span', 'upgrade-name', U.displayName));
      if (count > 1) item.append(el('span', 'upgrade-count', `×${count}`));
      const remove = button('−', `Remove one ${U.displayName}`, () => this.changeUpgrade(i, id, -1));
      const add = button('+', `Add another ${U.displayName}`, () => this.changeUpgrade(i, id, +1));
      add.disabled = count >= U.maxStacks;
      item.append(remove, add);
      list.append(item);
    }

    const adder = this.upgradeAdders[i];
    adder.replaceChildren(new Option(owned.length ? 'Add upgrade…' : 'Add upgrade… (none yet)', ''));
    const transformations = el('optgroup');
    transformations.label = 'Transformations';
    for (const U of upgradesFor(this.upgradeWeaponId(i), owned)) {
      const option = new Option(U.displayName, U.id);
      option.title = U.description;
      (U.transformation ? transformations : adder).append(option);
    }
    if (transformations.children.length > 0) adder.append(transformations);
    adder.value = '';
  }

  bindSettings() {
    const speed = byId('speed');
    const speedValue = byId('speed-value');
    this.pauseButton = byId('pause');

    onClick('restart', () => this.startMatch());
    onClick('pause', () => this.togglePause());

    const applySpeed = () => {
      this.setAll('timeScale', Number(speed.value));
      speedValue.textContent = `${speed.value}×`;
    };
    speed.addEventListener('input', applySpeed);
    speed.addEventListener('change', () => speed.blur());
    applySpeed();

    this.hitboxToggle = bindCheckbox('hitboxes', (on) => this.setAll('showHitboxes', on));
    bindCheckbox('auto-rematch', (on) => this.setAll('autoRematch', on));

    // The page-wide mute. In display mode each screen also has its own.
    this.soundToggle = byId('sound');
    this.soundToggle.checked = !Sound.muted;
    bindCheckbox('sound', (on) => (Sound.muted = !on));
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
          this.setAll('showHitboxes', this.hitboxToggle.checked);
          break;
        case 'KeyM':
          this.soundToggle.checked = !this.soundToggle.checked;
          Sound.muted = !this.soundToggle.checked;
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
    this.paused = !this.paused;
    this.setAll('paused', this.paused);
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
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

function button(text, label, onClickFn) {
  const node = el('button', 'upgrade-button', text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', (e) => {
    e.currentTarget.blur();
    onClickFn();
  });
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
