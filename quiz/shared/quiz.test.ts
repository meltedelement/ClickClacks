// Unit tests for the quiz's own rules: `node --test shared/*.test.ts` (or
// `npm test` in quiz/). The bracket formats are tested in tournament/.
import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleTransformations, fitLoadout } from './loadout.ts';
import { breakAfter, defaultSchedule, fitSchedule, nextBreak, stagesAllowed, transformationsOpen } from './rounds.ts';
import type { Catalog, RoundBreak } from './types.ts';

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

// Five rounds of two questions each.
const questions = Array.from({ length: 10 }, (_, i) => ({ round: `Round ${Math.floor(i / 2) + 1}` }));
const lastOfRound = [1, 3, 5, 7, 9];

test('by default a battle break follows every second round and the last round', () => {
  const quiz = { questions, schedule: defaultSchedule(5) };
  assert.deepEqual(
    questions.map((_, i) => breakAfter(quiz, i)),
    [false, false, false, true, false, false, false, true, false, true],
  );
  // Stages allowed at the end of each round: rounds 1-2 give one, 3-4 give two, and the last round all.
  assert.deepEqual(
    lastOfRound.map((i) => stagesAllowed(quiz, i)),
    [0, 1, 1, 2, Infinity],
  );
  assert.equal(stagesAllowed({ questions: [], schedule: [] }, 0), Infinity);
  // Transformation picks for every other break from the first, and the last break.
  assert.deepEqual(
    defaultSchedule(5).map((b) => b.transformation),
    [false, true, false, false, true],
  );
  assert.deepEqual(
    defaultSchedule(7).map((b) => b.transformation),
    [false, true, false, false, false, true, true],
  );
});

test('the schedule sets the breaks, their stages and their transformation picks', () => {
  const schedule: RoundBreak[] = [
    { stages: 1, transformation: true },
    { stages: 0, transformation: true }, // no break: its flag does nothing
    { stages: 2, transformation: false },
    { stages: 0, transformation: false },
    { stages: 1, transformation: true }, // the last round always plays the rest
  ];
  const quiz = { questions, schedule };
  assert.deepEqual(
    questions.map((_, i) => breakAfter(quiz, i)),
    [false, true, false, false, false, true, false, false, false, true],
  );
  assert.deepEqual(
    lastOfRound.map((i) => stagesAllowed(quiz, i)),
    [1, 1, 3, 3, Infinity],
  );
  // A break's transformation pick opens once the quiz is past the break before it.
  assert.deepEqual(
    questions.map((_, i) => transformationsOpen(quiz, i)),
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 2],
  );
  assert.deepEqual(
    questions.map((_, i) => nextBreak(quiz, i)?.round),
    [0, 0, 2, 2, 2, 2, 4, 4, 4, 4],
  );
});

test('a break that plays the rest ends the schedule', () => {
  const schedule: RoundBreak[] = [
    { stages: 0, transformation: false },
    { stages: 'rest', transformation: true },
    { stages: 1, transformation: true },
    { stages: 0, transformation: false },
    { stages: 'rest', transformation: true },
  ];
  const quiz = { questions, schedule };
  assert.deepEqual(
    questions.map((_, i) => breakAfter(quiz, i)),
    [false, false, false, true, false, false, false, false, false, false],
  );
  assert.deepEqual(
    lastOfRound.map((i) => stagesAllowed(quiz, i)),
    [0, Infinity, Infinity, Infinity, Infinity],
  );
  assert.equal(transformationsOpen(quiz, 9), 1);
  assert.equal(nextBreak(quiz, 4), null);
});

test('fitSchedule keeps a schedule that fits and makes the last round play the rest', () => {
  const schedule: RoundBreak[] = [
    { stages: 2, transformation: true },
    { stages: 1, transformation: false },
  ];
  assert.deepEqual(fitSchedule(schedule, 2), [schedule[0], { stages: 'rest', transformation: false }]);
  assert.deepEqual(fitSchedule(schedule, 3), defaultSchedule(3));
  assert.deepEqual(fitSchedule(undefined, 0), []);
});
