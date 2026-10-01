// Unit tests for the quiz's own rules: `node --test shared/*.test.ts` (or
// `npm test` in quiz/). The bracket formats are tested in tournament/.
import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleTransformations, fitLoadout } from './loadout.ts';
import { breakAfter, stagesAllowed } from './rounds.ts';
import type { Catalog } from './types.ts';

const catalog: Catalog = {
  upgradesPerCorrect: 1,
  offerSize: 3,
  weapons: [
    { id: 'sword', name: 'Sword' },
    { id: 'spear', name: 'Spear' },
    { id: 'mace', name: 'Mace' },
  ],
  upgrades: [
    { id: 'damage', name: 'Sharpened', description: '+' },
    { id: 'crit', name: 'Critical', description: '+' },
    { id: 'crit-damage', name: 'Deadly Crits', description: '+', weapons: ['spear'], requires: ['crit'] },
    { id: 'big-shield', name: 'Big Shield', description: '+', weapons: ['sword'], maxStacks: 2 },
  ],
  transformations: [
    { id: 'captain', name: 'Captain', description: '+', weapons: ['sword'], maxStacks: 1 },
    { id: 'stalwart', name: 'Stalwart', description: '+', weapons: ['sword'], maxStacks: 1 },
    { id: 'hoplite', name: 'Hoplite', description: '+', weapons: ['spear'], maxStacks: 1 },
  ],
};

test('eligibleTransformations offers the ones that fit and are not taken', () => {
  assert.deepEqual(eligibleTransformations({ name: 'A', weapon: 'sword', upgrades: {}, transformations: ['captain'] }, catalog), ['stalwart']);
  assert.deepEqual(eligibleTransformations({ name: 'A', weapon: 'spear', upgrades: {} }, catalog), ['hoplite']);
  assert.deepEqual(eligibleTransformations({ name: 'A', weapon: 'mace', upgrades: {} }, catalog), []);
});

test('fitLoadout drops what does not fit the weapon, then what required it', () => {
  const spear = { name: 'A', weapon: 'spear', upgrades: { damage: 1, crit: 1, 'crit-damage': 2 }, transformations: ['hoplite'] };
  assert.deepEqual(fitLoadout(spear, catalog), { upgrades: spear.upgrades, transformations: ['hoplite'], dropped: 0 });
  assert.deepEqual(fitLoadout({ ...spear, weapon: 'sword' }, catalog), { upgrades: { damage: 1, crit: 1 }, transformations: [], dropped: 2 });
  // A shared upgrade that requires a spear-only one goes too.
  const chained: Catalog = { ...catalog, upgrades: [...catalog.upgrades, { id: 'bleed', name: 'Bleed', description: '+', requires: ['crit-damage'] }] };
  assert.deepEqual(fitLoadout({ ...spear, weapon: 'mace', upgrades: { ...spear.upgrades, bleed: 1 } }, chained), {
    upgrades: { damage: 1, crit: 1 },
    transformations: [],
    dropped: 3,
  });
  // Ids the catalog does not know stay, for the game to report.
  assert.deepEqual(fitLoadout({ name: 'A', weapon: 'mace', upgrades: { mystery: 1 } }, catalog).upgrades, { mystery: 1 });
});

test('a battle break follows every second round and the last round', () => {
  // Five rounds of two questions each.
  const questions = Array.from({ length: 10 }, (_, i) => ({ round: `Round ${Math.floor(i / 2) + 1}` }));
  assert.deepEqual(
    questions.map((_, i) => breakAfter(questions, i)),
    [false, false, false, true, false, false, false, true, false, true],
  );
  // Stages allowed at the end of each round: rounds 1-2 give one, 3-4 give two, and the last round all.
  assert.deepEqual(
    [1, 3, 5, 7, 9].map((i) => stagesAllowed(questions, i)),
    [0, 1, 1, 2, Infinity],
  );
  assert.equal(stagesAllowed([], 0), Infinity);
});
