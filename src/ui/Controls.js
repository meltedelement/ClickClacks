import { WEAPONS, getWeaponById } from '../weapons/index.js';
import { getUpgradeById, upgradesFor } from '../upgrades/index.js';
import { Sound } from '../game/Sound.js';

const RANDOM = 'random';
const MAX_FIGHTERS = 8; // more don't fit around the spawn circle
const MAX_RANDOM_UPGRADES = 10;
const MIN_ROYALE = 3;
const MAX_ROYALE = 1000; // the sim slows down well before this; see README

// Wires the menu (fighter pickers, sim settings) and keyboard shortcuts to the
// games: one per arena normally (see Arenas), one per screen in display mode.
// Settings apply to all.
export class Controls {
  // In display mode the match API picks the matchups, so the matchup section
  // and auto rematch are hidden. `arenas` (the main page's Arenas) enables the
  // arena count setting; `games` is then its games array, which grows and shrinks.
  // `royale` (a ball count) starts the menu in royale mode, and `mix`
  // ({ weaponId: share }) sets its starting weapon mix (see bindWeaponMix).
  constructor(games, { fighters, displayMode = false, arenas = null, royale = null, mix = null }) {
    this.games = games;
    this.arenas = arenas;
    this.paused = false;
    this.settings = {}; // what setAll last set, for arenas added later

    this.bindFighterSettings(fighters);
    this.bindMode(royale, mix);
    this.bindArenaCount();
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
  // weapons already in the fight, so random matchups aren't mirrors. Each fighter
  // then gets `randomUpgrades` more upgrades rolled for its weapon, on top of the
  // picked ones. Transformations are only ever picked by hand.
  get lineup() {
    const weapons = this.selects.map((select) => (select.value === RANDOM ? null : getWeaponById(select.value)));
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i]) continue;
      const unused = WEAPONS.filter((W) => !weapons.includes(W));
      weapons[i] = randomItem(unused.length > 0 ? unused : WEAPONS);
    }
    return weapons.map((W, i) => ({ weapon: W.id, upgrades: this.rollUpgrades(W, [...this.fighterUpgrades[i]]) }));
  }

  // The next match for an arena (see Game's chooseMatch).
  nextMatch() {
    return this.royale ? { fighters: this.royaleLineup, royale: true } : { fighters: this.lineup };
  }

  // A royale's loadouts: each weapon as many times as the weapon mix gives it
  // (see royaleCounts), in a random order, each with `randomUpgrades` random upgrades.
  get royaleLineup() {
    const counts = royaleCounts(this.royaleCount, this.royaleShares);
    const weapons = WEAPONS.flatMap((W, i) => new Array(counts[i]).fill(W));
    for (let i = weapons.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weapons[i], weapons[j]] = [weapons[j], weapons[i]];
    }
    return weapons.map((W) => ({ weapon: W.id, upgrades: this.rollUpgrades(W, []) }));
  }

  // `upgrades` plus `randomUpgrades` more rolled for weapon W (never transformations).
  rollUpgrades(W, upgrades) {
    for (let n = 0; n < this.randomUpgrades; n++) {
      const choices = upgradesFor(W.id, upgrades).filter((U) => !U.transformation);
      if (choices.length === 0) break;
      upgrades.push(randomItem(choices).id);
    }
    return upgrades;
  }

  startMatch() {
    for (const game of this.games) game.newMatch();
  }

  // Standard (the fighters below) or royale (a crowd of random fighters, see
  // Simulation's `royale`). Royale hides the fighter pickers and shows a ball
  // count and the weapon mix. `mix` is the starting mix: { weaponId: share }.
  bindMode(royale, mix) {
    const mode = byId('mode');
    const count = byId('royale-count');
    this.royale = royale != null;
    this.royaleCount = clampCount(royale ?? Number(count.value));
    mode.value = this.royale ? 'royale' : 'standard';
    count.value = String(this.royaleCount);
    this.bindWeaponMix(mix);

    const show = () => {
      byId('fighter-count').closest('label').hidden = this.royale;
      byId('fighter-selects').hidden = this.royale;
      count.closest('label').hidden = !this.royale;
      byId('royale-mix').hidden = !this.royale;
    };
    show();
    mode.addEventListener('change', () => {
      mode.blur();
      this.royale = mode.value === 'royale';
      show();
      this.startMatch();
    });
    // Like the arena count: applied on Enter or when the box loses focus.
    count.addEventListener('change', () => {
      this.royaleCount = count.value === '' ? this.royaleCount : clampCount(Number(count.value));
      count.value = String(this.royaleCount);
      this.showMixCounts();
      if (this.royale) this.startMatch();
    });
    count.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') count.blur();
    });
  }

  // One share box per weapon. Shares are relative (60/40 and 3/2 are the same
  // mix) and 0 leaves a weapon out; all 0 counts as even. Each row shows the
  // balls that works out to, live while typing; the match restarts on Enter
  // or when the box loses focus, like the other number boxes.
  bindWeaponMix(mix) {
    const rows = byId('royale-mix-rows');
    this.royaleShares = WEAPONS.map((W) => (mix ? (mix[W.id] ?? 0) : 1));
    this.mixInputs = [];
    this.mixCounts = [];
    WEAPONS.forEach((W, i) => {
      const label = el('label', 'field');
      label.append(el('span', 'field-label', W.displayName));
      const input = el('input');
      Object.assign(input, { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(this.royaleShares[i]) });
      input.setAttribute('aria-label', `${W.displayName} share`);
      const read = () => Math.max(0, Number(input.value) || 0);
      input.addEventListener('input', () => {
        this.royaleShares[i] = read();
        this.showMixCounts();
      });
      input.addEventListener('change', () => {
        this.royaleShares[i] = read();
        input.value = String(this.royaleShares[i]);
        this.showMixCounts();
        if (this.royale) this.startMatch();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      const counted = el('span', 'royale-mix-count');
      label.append(input, counted);
      rows.append(label);
      this.mixInputs.push(input);
      this.mixCounts.push(counted);
    });
    onClick('royale-mix-even', () => {
      this.royaleShares = WEAPONS.map(() => 1);
      this.mixInputs.forEach((input) => (input.value = '1'));
      this.showMixCounts();
      if (this.royale) this.startMatch();
    });
    this.showMixCounts();
  }

  showMixCounts() {
    const counts = royaleCounts(this.royaleCount, this.royaleShares);
    const total = counts.reduce((a, b) => a + b, 0);
    counts.forEach((n, i) => {
      const percent = total > 0 ? Math.round((n / total) * 100) : 0;
      this.mixCounts[i].textContent = `${n} · ${percent}%`;
    });
  }

  // Sets a property on every game, and on any arena added later.
  setAll(key, value) {
    this.settings[key] = value;
    for (const game of this.games) game[key] = value;
  }

  // The number of arenas playing side by side. New ones take the current
  // settings and start a match of their own; the rest keep playing.
  // A typed number, applied on Enter or when the box loses focus (not on every
  // keystroke, so typing "12" doesn't build one arena on the way). The arrows
  // apply straight away. There's no upper limit; below 1 snaps to 1, and a cleared
  // box goes back to the current count.
  bindArenaCount() {
    const input = byId('arena-count');
    if (!this.arenas) {
      input.closest('label').hidden = true;
      return;
    }
    input.addEventListener('change', () => this.setArenaCount(input.value === '' ? this.games.length : Number(input.value)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur(); // blurring fires 'change'
    });
    this.arenaInput = input;
  }

  setArenaCount(n) {
    n = Math.max(1, Math.round(n) || 1);
    this.arenaInput.value = String(n);
    for (const game of this.arenas.setCount(n)) {
      Object.assign(game, this.settings);
      game.newMatch();
      game.start();
    }
  }

  // The fighter count and random upgrade selects. Changing either starts a new match.
  bindFighterSettings(fighters) {
    // Upgrade ids per fighter, in the order added; a repeated id is a stack.
    this.fighterUpgrades = [];
    this.fighterRows = [];
    this.selects = [];
    this.upgradeLists = [];
    this.upgradeAdders = [];
    this.randomUpgrades = 0;

    const count = byId('fighter-count');
    for (let n = 2; n <= MAX_FIGHTERS; n++) count.append(new Option(String(n), String(n)));
    count.value = String(fighters);
    count.addEventListener('change', () => {
      count.blur();
      this.setFighterCount(Number(count.value));
      this.startMatch();
    });
    this.setFighterCount(fighters);

    const random = byId('random-upgrades');
    for (let n = 0; n <= MAX_RANDOM_UPGRADES; n++) random.append(new Option(String(n), String(n)));
    random.value = '0';
    random.addEventListener('change', () => {
      random.blur();
      this.randomUpgrades = Number(random.value);
      this.startMatch();
    });
  }

  // Adds or removes fighters at the end; the others keep their weapon and upgrades.
  setFighterCount(n) {
    while (this.selects.length < n) this.addFighter(this.selects.length);
    while (this.selects.length > n) {
      this.fighterRows.pop().remove();
      this.selects.pop();
      this.fighterUpgrades.pop();
      this.upgradeLists.pop();
      this.upgradeAdders.pop();
    }
  }

  addFighter(i) {
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
    byId('fighter-selects').append(fighter);
    this.fighterRows.push(fighter);
    this.selects.push(select);
    this.fighterUpgrades.push([]);
    this.upgradeLists.push(list);
    this.upgradeAdders.push(adder);
    this.renderUpgrades(i);
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
    onClick('end-match', () => this.games.forEach((game) => game.endMatch()));

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
      // Don't steal keys from a select or a box being typed in (Space, R, H...).
      if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type === 'number')) return;

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

// Splits `total` balls between the weapons in proportion to `shares` (one
// per weapon in WEAPONS order), rounding so they still add up to `total`:
// each gets its whole number, then the largest remainders get one more.
// No shares at all counts as an even mix.
export function royaleCounts(total, shares) {
  const sum = shares.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? shares : shares.map(() => 1);
  const weightSum = sum > 0 ? sum : shares.length;
  const exact = weights.map((w) => (total * w) / weightSum);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => i).sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b);
  for (const i of byRemainder) {
    if (left <= 0) break;
    counts[i] += 1;
    left -= 1;
  }
  return counts;
}

function clampCount(n) {
  return Math.min(MAX_ROYALE, Math.max(MIN_ROYALE, Math.round(n) || MIN_ROYALE));
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
