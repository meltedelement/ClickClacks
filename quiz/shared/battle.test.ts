// Unit tests for the pure battle logic: `node --test shared/battle.test.ts`
// (or `npm test` in quiz/). No server or game needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedule, standings, validateLoadout } from './battle.ts';
import type { BattleMatch, Catalog } from './types.ts';

const catalog: Catalog = {
  upgradesPerCorrect: 1,
  offerSize: 3,
  weapons: [
    { id: 'sword', name: 'Sword' },
    { id: 'spear', name: 'Spear' },
  ],
  upgrades: [
    { id: 'damage', name: 'Sharpened', description: '+' },
    { id: 'crit', name: 'Critical', description: '+' },
    { id: 'crit-damage', name: 'Deadly Crits', description: '+', weapons: ['spear'], requires: ['crit'] },
    { id: 'big-shield', name: 'Big Shield', description: '+', weapons: ['sword'], maxStacks: 2 },
  ],
};

test('buildSchedule handles an even team count', () => {
  const pairs = buildSchedule(['a', 'b', 'c', 'd'], () => 7);
  assert.equal(pairs.length, 6); // 4 * 3 / 2
  const keys = pairs.map((p) => [p.a, p.b].sort().join('+'));
  assert.equal(new Set(keys).size, 6); // every pair exactly once
  assert.ok(pairs.every((p) => p.seed === 7));
});

test('buildSchedule gives an odd team count a bye instead of a match', () => {
  const pairs = buildSchedule(['a', 'b', 'c'], () => 1);
  assert.equal(pairs.length, 3);
  assert.deepEqual(
    pairs.map((p) => [p.a, p.b].sort().join('+')).sort(),
    ['a+b', 'a+c', 'b+c'],
  );
  assert.ok(pairs.every((p) => p.a && p.b));
});

test('buildSchedule needs two teams', () => {
  assert.deepEqual(buildSchedule([], () => 1), []);
  assert.deepEqual(buildSchedule(['a'], () => 1), []);
});

test('buildSchedule gives every pairing one unique seed', () => {
  let n = 0;
  const pairs = buildSchedule(['a', 'b', 'c', 'd', 'e'], () => n++);
  assert.equal(pairs.length, 10);
  assert.equal(new Set(pairs.map((p) => p.seed)).size, 10);
});

function match(a: string, b: string, winner: string | null, hp: [number, number] = [100, 0]): BattleMatch {
  return {
    id: `${a}-${b}`,
    a,
    b,
    seed: 1,
    gameId: null,
    status: 'done',
    fighters: [
      { name: a, weapon: 'sword', upgrades: {} },
      { name: b, weapon: 'sword', upgrades: {} },
    ],
    winner,
    hp,
    time: 10,
  };
}

test('standings count a win, a draw and a loss', () => {
  const teams = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ];
  const rows = standings(teams, [
    match('a', 'b', 'a', [100, 0]),
    match('a', 'c', 'c', [0, 100]),
    match('b', 'c', null, [50, 50]),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.points, r.wins, r.draws, r.losses, r.played]),
    [
      ['Gamma', 1.5, 1, 1, 0, 2],
      ['Alpha', 1, 1, 0, 1, 2],
      ['Beta', 0.5, 0, 1, 1, 2],
    ],
  );
});

test('standings ignore matches that never finished', () => {
  const teams = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
  const rows = standings(teams, [
    { ...match('a', 'b', 'a'), status: 'failed' },
    { ...match('a', 'b', 'a'), status: 'cancelled' },
  ]);
  assert.deepEqual(rows.map((r) => r.points), [0, 0]);
});

test('standings break a points tie on HP difference', () => {
  const teams = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }];
  // a and b both beat c; a finished with more HP left over.
  const rows = standings(teams, [
    match('a', 'c', 'a', [90, 0]),
    match('b', 'c', 'b', [10, 0]),
    match('a', 'b', null, [0, 0]),
  ]);
  const order = rows.map((r) => r.name);
  assert.deepEqual(order.slice(0, 2), ['Alpha', 'Beta']);
});

test('validateLoadout accepts a loadout the game would take', () => {
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'spear', upgrades: { crit: 1, 'crit-damage': 1 } }, catalog), []);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { 'big-shield': 2 } }, catalog), []);
});

test('validateLoadout reports unknown ids, wrong weapons, stack limits and missing requires', () => {
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'axe', upgrades: {} }, catalog), ['unknown weapon "axe"']);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { nope: 1 } }, catalog), ['unknown upgrade "nope"']);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { 'crit-damage': 1 } }, catalog), [
    '"crit-damage" does not fit sword',
    '"crit-damage" needs "crit"',
  ]);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { 'big-shield': 3 } }, catalog), [
    '"big-shield" ×3 is over its limit of 2',
  ]);
});
