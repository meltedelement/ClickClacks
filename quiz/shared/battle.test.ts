// Unit tests for the pure battle logic: `node --test shared/battle.test.ts`
// (or `npm test` in quiz/). No server or game needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { advance, currentRound, drawBracket, mulberry32, roundComplete, roundMatches, teamProgress, validateLoadout } from './battle.ts';
import type { Battle, Catalog } from './types.ts';

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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

// Plays the current round: the first team in each match wins.
function playRound(battle: Pick<Battle, 'rounds' | 'matches' | 'seed' | 'champion'>) {
  const round = currentRound(battle)!;
  for (const m of roundMatches(battle, round.index)) Object.assign(m, { status: 'done', winner: m.a, decidedBy: 'ko' });
  round.status = 'done';
  const next = advance(battle);
  if ('champion' in next) battle.champion = next.champion;
  else {
    battle.rounds.push(next.round);
    battle.matches.push(...next.matches);
  }
}

function bracket(n: number, seed = 42) {
  return { seed, champion: null as string | null, ...drawBracket(ids(n), seed) };
}

test('eight teams: quarter-finals, semi-finals, final', () => {
  const battle = bracket(8);
  assert.deepEqual(battle.rounds.map((r) => r.name), ['Quarter-finals']);
  assert.equal(battle.matches.length, 4);
  assert.equal(battle.rounds[0].bye, null);
  // Every team is drawn exactly once.
  assert.deepEqual(battle.matches.flatMap((m) => [m.a, m.b]).sort(), ids(8).sort());

  playRound(battle);
  playRound(battle);
  assert.deepEqual(battle.rounds.map((r) => [r.name, roundMatches(battle, r.index).length]), [
    ['Quarter-finals', 4],
    ['Semi-finals', 2],
    ['Final', 1],
  ]);
  playRound(battle);
  const final = roundMatches(battle, 2)[0];
  assert.equal(battle.champion, final.a);
});

test('six teams: the odd team out in a round goes through on a bye', () => {
  const battle = bracket(6);
  assert.equal(battle.matches.length, 3);
  assert.equal(battle.rounds[0].bye, null);

  playRound(battle); // 3 winners
  const semi = battle.rounds[1];
  assert.equal(roundMatches(battle, 1).length, 1);
  assert.ok(semi.bye);

  playRound(battle); // the bye team and the semi-final winner
  const final = roundMatches(battle, 2);
  assert.equal(final.length, 1);
  assert.equal(battle.rounds[2].name, 'Final');
  // The team with the bye plays in the final.
  assert.ok(final[0].a === semi.bye || final[0].b === semi.bye);
});

test('a team never gets two byes in a row', () => {
  for (const n of [3, 5, 7, 9, 11]) {
    const battle = bracket(n, n * 7);
    let previousBye: string | null = null;
    while (!battle.champion) {
      const round = currentRound(battle)!;
      if (previousBye) assert.notEqual(round.bye, previousBye, `${n} teams, ${round.name}`);
      previousBye = round.bye;
      playRound(battle);
    }
  }
});

test('the same seed gives the same draw and match seeds', () => {
  const one = drawBracket(ids(8), 1234);
  const two = drawBracket(ids(8), 1234);
  assert.deepEqual(one, two);
  const other = drawBracket(ids(8), 99);
  assert.notDeepEqual(one.matches.map((m) => [m.a, m.b]), other.matches.map((m) => [m.a, m.b]));
  assert.equal(new Set(one.matches.map((m) => m.seed)).size, 4);
});

test('drawBracket needs two teams', () => {
  assert.throws(() => drawBracket(['a'], 1));
  const two = drawBracket(['a', 'b'], 1);
  assert.equal(two.rounds[0].name, 'Final');
});

test('advance refuses a round with a match still to play', () => {
  const battle = bracket(4);
  assert.equal(roundComplete(battle, 0), false);
  assert.throws(() => advance(battle));
});

test('teamProgress follows a team through the bracket', () => {
  const battle = bracket(4);
  const [m1] = battle.matches;
  assert.deepEqual(teamProgress(battle, m1.a), { state: 'waiting', opponent: m1.b });
  battle.rounds[0].status = 'playing';
  assert.equal(teamProgress(battle, m1.a).state, 'fighting');
  Object.assign(m1, { status: 'done', winner: m1.a });
  assert.equal(teamProgress(battle, m1.a).state, 'through');
  assert.equal(teamProgress(battle, m1.b).state, 'out');
  playRound(battle); // the rest of the semi-finals
  const final = roundMatches(battle, 1)[0];
  assert.deepEqual(teamProgress(battle, final.b), { state: 'waiting', opponent: final.a });
  playRound(battle); // the final; the first team wins
  assert.equal(teamProgress(battle, final.a).state, 'champion');
  assert.equal(teamProgress(battle, final.b).state, 'out');
});

test('mulberry32 matches the game', () => {
  // First values of src/sim/random.js with seed 1.
  const random = mulberry32(1);
  assert.deepEqual([random(), random()].map((x) => x.toFixed(6)), ['0.627074', '0.002736']);
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
