// Unit tests for the pure battle logic: `node --test shared/battle.test.ts`
// (or `npm test` in quiz/). No server or game needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advance,
  currentRound,
  drawBracket,
  drawLosers,
  eligibleTransformations,
  fitLoadout,
  lossCount,
  mulberry32,
  plannedStages,
  roundComplete,
  roundMatches,
  teamProgress,
  undrawLosers,
  validateLoadout,
} from './battle.ts';
import { breakAfter, stagesAllowed } from './rounds.ts';
import type { Battle, BattleMatch, Catalog } from './types.ts';

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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

type TestBattle = Pick<Battle, 'rounds' | 'matches' | 'seed' | 'champion'>;

// Plays the current stage: the winners bracket, then the losers bracket. `pick`
// chooses each winner; by default the first team wins.
function playStage(battle: TestBattle, pick: (m: BattleMatch) => string = (m) => m.a) {
  const round = currentRound(battle)!;
  const play = (matches: BattleMatch[]) => matches.forEach((m) => Object.assign(m, { status: 'done', winner: pick(m), decidedBy: 'ko' }));
  play(roundMatches(battle, round.index));
  play(drawLosers(battle));
  round.status = 'done';
  const next = advance(battle);
  if ('champion' in next) battle.champion = next.champion;
  else {
    battle.rounds.push(next.round);
    battle.matches.push(...next.matches);
  }
}

function bracket(n: number, seed = 42): TestBattle {
  return { seed, champion: null, ...drawBracket(ids(n), seed) };
}

function playOut(battle: TestBattle, pick?: (m: BattleMatch) => string) {
  for (let i = 0; i < 100 && !battle.champion; i++) playStage(battle, pick);
  assert.ok(battle.champion, 'the battle ends');
}

const groupSizes = (battle: TestBattle) => battle.rounds.map((r) => r.groups.map((g) => `${g.side[0]}${g.teams.length}`).join(' '));

test('eight teams: the double elimination takes five stages', () => {
  const battle = bracket(8);
  assert.equal(battle.matches.length, 4);
  assert.deepEqual(battle.matches.flatMap((m) => [m.a, m.b]).sort(), ids(8).sort());
  playOut(battle);
  assert.deepEqual(groupSizes(battle), ['w8 l4', 'w4 l4', 'w2 l3', 'w1 l2', 'f2']);
  assert.deepEqual(
    battle.rounds.map((r) => r.groups.map((g) => g.name)),
    [
      ['Winners quarter-finals', 'Losers round 1'],
      ['Winners semi-finals', 'Losers round 2'],
      ['Winners final', 'Losers round 3'],
      ['Winners bracket champion', 'Losers final'],
      ['Grand final'],
    ],
  );
  // The first team always wins, so the winners bracket champion takes it without a reset.
  const final = roundMatches(battle, 4)[0];
  assert.equal(final.side, 'final');
  assert.equal(battle.champion, final.a);
});

test('every team except the champion loses exactly twice', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12, 16]) {
    for (const seed of [1, 2, 3]) {
      const battle = bracket(n, seed);
      const random = mulberry32(seed * 1000 + n);
      playOut(battle, (m) => (random() < 0.5 ? m.a : m.b));
      for (const id of ids(n)) {
        const losses = lossCount(battle, id);
        if (id === battle.champion) assert.ok(losses <= 1, `${n} teams, champion lost ${losses}`);
        else assert.equal(losses, 2, `${n} teams, seed ${seed}, ${id}`);
      }
    }
  }
});

test('a loss in the winners bracket drops the team to the losers bracket of the same stage', () => {
  const battle = bracket(4);
  const firstRound = roundMatches(battle, 0);
  for (const m of firstRound) Object.assign(m, { status: 'done', winner: m.a });
  assert.equal(drawLosers(battle).length, 1);
  const losers = currentRound(battle)!.groups.find((g) => g.side === 'losers')!;
  assert.deepEqual([...losers.teams].sort(), firstRound.map((m) => m.b).sort());
});

test('the losers bracket pairs its survivors with the teams that just dropped', () => {
  const battle = bracket(8);
  playStage(battle); // winners quarter-finals and losers round 1
  const survivors = roundMatches(battle, 0).filter((m) => m.side === 'losers').map((m) => m.winner);
  const winners = roundMatches(battle, 1);
  for (const m of winners) Object.assign(m, { status: 'done', winner: m.a });
  const losers = drawLosers(battle);
  assert.equal(losers.length, 2);
  for (const m of losers) {
    assert.ok(survivors.includes(m.a) && winners.some((w) => w.b === m.b), `${m.id}: a survivor against a dropped team`);
  }
});

test('the losers bracket champion must beat the winners bracket champion twice', () => {
  const battle = bracket(4);
  // The first team wins everywhere except the grand final.
  playOut(battle, (m) => (m.side === 'final' ? m.b : m.a));
  const finals = battle.matches.filter((m) => m.side === 'final');
  assert.equal(finals.length, 2);
  assert.equal(battle.rounds[battle.rounds.length - 1].groups[0].name, 'Grand final reset');
  assert.equal(battle.champion, finals[0].b);
});

test('a team never gets two byes in a row while its bracket has other teams', () => {
  for (const n of [3, 5, 6, 7, 9, 11, 13]) {
    const battle = bracket(n, n * 7);
    const random = mulberry32(n);
    const previous = new Map<string, string | null>();
    while (!battle.champion) {
      for (const group of currentRound(battle)!.groups) {
        if (group.bye && group.teams.length > 1) assert.notEqual(previous.get(group.side), group.bye, `${n} teams, ${group.name}`);
        previous.set(group.side, group.teams.length > 1 ? group.bye : null);
      }
      playStage(battle, (m) => (random() < 0.5 ? m.a : m.b));
    }
  }
});

test('plannedStages gives the same shape as a played bracket', () => {
  for (const n of [2, 3, 5, 8, 11]) {
    const battle = bracket(n, 5);
    const random = mulberry32(n);
    playOut(battle, (m) => (m.side === 'final' ? m.a : random() < 0.5 ? m.a : m.b));
    assert.deepEqual(
      plannedStages(n).map((stage) => stage.map((g) => `${g.side[0]}${g.size}`).join(' ')),
      groupSizes(battle),
      `${n} teams`,
    );
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
  assert.equal(two.rounds[0].groups[0].name, 'Winners final');
});

test('advance refuses a stage with a match still to play', () => {
  const battle = bracket(4);
  assert.equal(roundComplete(battle, 0), false);
  assert.throws(() => advance(battle));
});

test('teamProgress follows a team through both brackets', () => {
  const battle = bracket(4);
  const [m1] = battle.matches;
  assert.deepEqual(teamProgress(battle, m1.a), { state: 'waiting', opponent: m1.b, side: 'winners', bracket: 'Winners semi-finals', losses: 0 });
  battle.rounds[0].status = 'playing';
  assert.equal(teamProgress(battle, m1.a).state, 'fighting');
  Object.assign(m1, { status: 'done', winner: m1.a });
  assert.equal(teamProgress(battle, m1.a).state, 'through');
  assert.equal(teamProgress(battle, m1.b).state, 'dropped');
  playStage(battle);
  assert.equal(teamProgress(battle, m1.b).side, 'losers');
  playStage(battle); // winners final and losers round 1; the first team wins
  const losersRound = roundMatches(battle, 1).find((m) => m.side === 'losers')!;
  assert.equal(teamProgress(battle, losersRound.b).state, 'out');
  playOut(battle);
  assert.equal(teamProgress(battle, battle.champion!).state, 'champion');
});

test('the losers bracket of a stage is drawn when its winners bracket is finished', () => {
  const battle = bracket(8);
  playStage(battle); // stage 2: winners semi-finals, and losers round 2 waits
  const stage = currentRound(battle)!;
  const winners = roundMatches(battle, 1);
  const survivors = [...stage.groups[1].teams];
  assert.ok(winners.every((m) => m.side === 'winners'));
  assert.equal(stage.groups[1].pending, true);
  stage.status = 'playing';
  assert.equal(teamProgress(battle, survivors[0]).state, 'next');
  Object.assign(winners[0], { status: 'done', winner: winners[0].a });
  assert.deepEqual(drawLosers(battle), []); // a winners match is still to play
  Object.assign(winners[1], { status: 'done', winner: winners[1].a });
  assert.equal(roundComplete(battle, 1), false); // the losers bracket is not drawn yet
  assert.equal(drawLosers(battle).length, 2);
  assert.equal(teamProgress(battle, survivors[0]).state, 'fighting');
  assert.equal(teamProgress(battle, winners[0].b).state, 'fighting'); // it dropped, and fights again in this stage
  // A winners match played again takes the draw back; the survivors stay.
  undrawLosers(battle);
  assert.equal(roundMatches(battle, 1).filter((m) => m.side === 'losers').length, 0);
  assert.deepEqual(currentRound(battle)!.groups[1].teams, survivors);
  assert.equal(currentRound(battle)!.groups[1].pending, true);
});

test('mulberry32 matches the game', () => {
  // First values of src/sim/random.js with seed 1.
  const random = mulberry32(1);
  assert.deepEqual([random(), random()].map((x) => x.toFixed(6)), ['0.627074', '0.002736']);
});

test('validateLoadout accepts a loadout the game would take', () => {
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'spear', upgrades: { crit: 1, 'crit-damage': 1 }, transformations: ['hoplite'] }, catalog), []);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { 'big-shield': 2 }, transformations: ['captain', 'stalwart'] }, catalog), []);
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

test('validateLoadout keeps transformations and upgrades apart', () => {
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: { captain: 1 } }, catalog), ['"captain" is a transformation']);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: {}, transformations: ['damage'] }, catalog), ['"damage" is not a transformation']);
  assert.deepEqual(validateLoadout({ name: 'A', weapon: 'sword', upgrades: {}, transformations: ['hoplite', 'captain', 'captain'] }, catalog), [
    '"hoplite" does not fit sword',
    '"captain" ×2 is over its limit of 1',
  ]);
});

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
  // Ids the catalog does not know stay, for validateLoadout to report.
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
