import './styles.css';
import { Quality } from './game/Quality.js';
import { Arenas } from './ui/Arenas.js';
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
// `?display&embed` is the display inside the quiz's big-screen page: no menu,
// since nobody reaches it there.
if (params.has('embed')) document.documentElement.classList.add('embedded');

if (displayMode) {
  const display = new TournamentDisplay(document.querySelector('.stage'));
  new Controls(display.games, { fighters: 2, displayMode });
} else {
  // One arena to start with; the menu's Arenas setting runs more side by side.
  // `?royale` (or `?royale=150`) starts in royale mode, with that many balls,
  // and `&mix=sword:60,spear:40` sets its weapon mix (weapons left out get none).
  const royale = params.has('royale') ? Number(params.get('royale')) || 100 : null;
  const mix = params.has('mix') ? parseMix(params.get('mix')) : null;
  const arenas = new Arenas(document.querySelector('.stage'), {
    chooseMatch: () => controls.nextMatch(),
  });
  const controls = new Controls(arenas.games, { fighters: 2, arenas, royale, mix });
  controls.setArenaCount(1);
}

// `sword:60,spear:40` -> { sword: 60, spear: 40 }. Unknown weapons and bad numbers are skipped.
function parseMix(text) {
  const mix = {};
  for (const part of text.split(',')) {
    const [id, share] = part.split(':');
    const n = Number(share);
    if (id && Number.isFinite(n) && n >= 0) mix[id.trim()] = n;
  }
  return mix;
}
