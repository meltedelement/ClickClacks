// Regenerates quiz/data/game.json from the game's own registries.
//
// The quiz normally gets its catalog live from the game's match API
// (GET /api/catalog). This file is the offline fallback for when the game
// server is not running, so it must agree with the game exactly. Run it after
// adding or changing a weapon, upgrade or stack limit:
//
//   npm run sync-catalog      (in quiz/)
//
// The quiz-only settings (upgradesPerCorrect, offerSize, exclude) are kept from
// the current file. The output is deterministic, so running it twice leaves the
// file unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { WEAPONS } from '../../src/weapons/index.js';
import { UPGRADES } from '../../src/upgrades/index.js';

const FILE = path.join(import.meta.dirname, '..', 'data', 'game.json');

const previous = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};

const catalog = {
  upgradesPerCorrect: previous.upgradesPerCorrect ?? 1,
  offerSize: previous.offerSize ?? 3,
  exclude: previous.exclude ?? [], // upgrade ids the quiz never offers
  weapons: WEAPONS.map((W) => ({ id: W.id, name: W.displayName })),
  upgrades: UPGRADES.map((U) => ({
    id: U.id,
    name: U.displayName,
    description: U.description,
    weapons: U.weapons, // null = any weapon
    requires: U.requires ?? [],
    maxStacks: Number.isFinite(U.maxStacks) ? U.maxStacks : null, // null = no limit
    transformation: Boolean(U.transformation),
  })),
};

const json = `${JSON.stringify(catalog, null, 2)}\n`;
const changed = fs.readFileSync(FILE, 'utf8') !== json;
fs.writeFileSync(FILE, json);
console.log(
  `${changed ? 'Wrote' : 'Unchanged'}: ${path.relative(process.cwd(), FILE)} — ` +
    `${catalog.weapons.length} weapons, ${catalog.upgrades.length} upgrades`,
);
