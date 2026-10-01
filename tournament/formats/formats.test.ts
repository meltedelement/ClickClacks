// Unit tests for the tournament formats: `node --test formats/*.test.ts` (or
// `npm test` in tournament/). No server or game needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TournamentMatch } from '../../api/tournament.d.ts';
import { mulberry32 } from '../lib/random.ts';
import { currentStage, plan, stageComplete, stageMatches } from './common.ts';
import { doubleElimination } from './double-elimination.ts';
import type { Format, FormatState } from './Format.ts';
import { roundRobin } from './round-robin.ts';
import { singleElimination } from './single-elimination.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const first = (m: TournamentMatch) => m.entrants[0];
const second = (m: TournamentMatch) => m.entrants[1];
const decide = (m: TournamentMatch, winner: string) => Object.assign(m, { status: 'done', winner, decidedBy: 'ko' });

function start(format: Format, n: number, seed = 42, legs = 1): FormatState {
  const entrants = ids(n);
  const options = { legs };
  return { seed, options, entrants: entrants.map((id) => ({ id })), champion: null, ...format.create(entrants, seed, options) };
}

// Plays the current stage, including anything drawn inside it. `pick` chooses
// each winner; by default the first entrant wins.
function playStage(format: Format, t: FormatState, pick: (m: TournamentMatch) => string = first) {
  const stage = currentStage(t)!;
  for (const m of stageMatches(t, stage.index)) decide(m, pick(m));
  for (let more = format.update(t); more.length > 0; more = format.update(t)) for (const m of more) decide(m, pick(m));
  stage.status = 'done';
  const next = format.advance(t);
  if ('champion' in next) t.champion = next.champion;
  else {
    t.stages.push(next.stage);
    t.matches.push(...next.matches);
  }
}

function playOut(format: Format, t: FormatState, pick?: (m: TournamentMatch) => string) {
  for (let i = 0; i < 1000 && !t.champion; i++) playStage(format, t, pick);
  assert.ok(t.champion, 'the tournament ends');
}

const losses = (t: FormatState, id: string) => t.matches.filter((m) => m.status === 'done' && m.winner !== id && m.entrants.includes(id)).length;
const groupSizes = (t: FormatState) => t.stages.map((s) => s.groups.map((g) => `${g.side[0]}${g.entrants.length}`).join(' '));
const randomPick = (seed: number) => {
  const random = mulberry32(seed);
  return (m: TournamentMatch) => (random() < 0.5 ? first(m) : second(m));
};

// ---- Double elimination -------------------------------------------------------

const de = doubleElimination;

test('double elimination: eight entrants take five stages', () => {
  const t = start(de, 8);
  assert.equal(t.matches.length, 4);
  assert.deepEqual(t.matches.flatMap((m) => m.entrants).sort(), ids(8).sort());
  playOut(de, t);
  assert.deepEqual(groupSizes(t), ['w8 l4', 'w4 l4', 'w2 l3', 'w1 l2', 'f2']);
  assert.deepEqual(
    t.stages.map((s) => s.groups.map((g) => g.name)),
    [
      ['Winners quarter-finals', 'Losers round 1'],
      ['Winners semi-finals', 'Losers round 2'],
      ['Winners final', 'Losers round 3'],
      ['Winners bracket champion', 'Losers final'],
      ['Grand final'],
    ],
  );
  const final = stageMatches(t, 4)[0];
  assert.equal(final.side, 'final');
  assert.equal(t.champion, first(final));
});

test('double elimination: everyone but the champion loses exactly twice', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12, 16]) {
    for (const seed of [1, 2, 3]) {
      const t = start(de, n, seed);
      playOut(de, t, randomPick(seed * 1000 + n));
      for (const id of ids(n)) {
        if (id === t.champion) assert.ok(losses(t, id) <= 1, `${n} entrants, champion lost ${losses(t, id)}`);
        else assert.equal(losses(t, id), 2, `${n} entrants, seed ${seed}, ${id}`);
      }
    }
  }
});

test('double elimination: a winners bracket loss drops to the losers bracket of the same stage', () => {
  const t = start(de, 4);
  const firstRound = stageMatches(t, 0);
  for (const m of firstRound) decide(m, first(m));
  assert.equal(de.update(t).length, 1);
  const losers = currentStage(t)!.groups.find((g) => g.side === 'losers')!;
  assert.deepEqual([...losers.entrants].sort(), firstRound.map(second).sort());
});

test('double elimination: the losers bracket pairs its survivors with the entrants that just dropped', () => {
  const t = start(de, 8);
  playStage(de, t);
  const survivors = stageMatches(t, 0).filter((m) => m.side === 'losers').map((m) => m.winner);
  const winners = stageMatches(t, 1);
  for (const m of winners) decide(m, first(m));
  const losers = de.update(t);
  assert.equal(losers.length, 2);
  for (const m of losers) assert.ok(survivors.includes(first(m)) && winners.some((w) => second(w) === second(m)), `${m.id}`);
});

test('double elimination: the losers bracket champion must win the grand final twice', () => {
  const t = start(de, 4);
  playOut(de, t, (m) => (m.side === 'final' ? second(m) : first(m)));
  const finals = t.matches.filter((m) => m.side === 'final');
  assert.equal(finals.length, 2);
  assert.equal(t.stages[t.stages.length - 1].groups[0].name, 'Grand final reset');
  assert.equal(t.champion, second(finals[0]));
});

test('double elimination: no two byes in a row while the bracket has others', () => {
  for (const n of [3, 5, 6, 7, 9, 11, 13]) {
    const t = start(de, n, n * 7);
    const pick = randomPick(n);
    const previous = new Map<string, string | null>();
    while (!t.champion) {
      for (const group of currentStage(t)!.groups) {
        if (group.bye && group.entrants.length > 1) assert.notEqual(previous.get(group.side), group.bye, `${n} entrants, ${group.name}`);
        previous.set(group.side, group.entrants.length > 1 ? group.bye : null);
      }
      playStage(de, t, pick);
    }
  }
});

test('double elimination: the plan has the shape of a played tournament', () => {
  for (const n of [2, 3, 5, 8, 11]) {
    const t = start(de, n, 5);
    const pick = randomPick(n);
    playOut(de, t, (m) => (m.side === 'final' ? first(m) : pick(m)));
    assert.deepEqual(
      plan(de, n, { legs: 1 }).map((stage) => stage.map((g) => `${g.side[0]}${g.size}`).join(' ')),
      groupSizes(t),
      `${n} entrants`,
    );
  }
});

test('double elimination: the same seed gives the same draw and match seeds', () => {
  const one = de.create(ids(8), 1234, { legs: 1 });
  assert.deepEqual(one, de.create(ids(8), 1234, { legs: 1 }));
  const other = de.create(ids(8), 99, { legs: 1 });
  assert.notDeepEqual(one.matches.map((m) => m.entrants), other.matches.map((m) => m.entrants));
  assert.equal(new Set(one.matches.map((m) => m.seed)).size, 4);
});

test('double elimination: the draw is the one the quiz made before the split', () => {
  // Recorded from quiz/shared/battle.ts drawBracket(['t1'..'t8'], 1234).
  const { matches } = de.create(ids(8), 1234, { legs: 1 });
  assert.deepEqual(
    matches.map((m) => [m.id, ...m.entrants, m.seed]),
    [
      ['s1w1', 't2', 't3', 729385128],
      ['s1w2', 't4', 't8', 1183476281],
      ['s1w3', 't7', 't6', 2128177455],
      ['s1w4', 't5', 't1', 633295528],
    ],
  );
});

test('double elimination: needs two entrants', () => {
  assert.throws(() => de.create(['a'], 1, { legs: 1 }));
  assert.equal(de.create(['a', 'b'], 1, { legs: 1 }).stages[0].groups[0].name, 'Winners final');
});

test('double elimination: advance refuses an unfinished stage', () => {
  const t = start(de, 4);
  assert.equal(stageComplete(t, 0), false);
  assert.throws(() => de.advance(t));
});

test('double elimination: progress follows an entrant through both brackets', () => {
  const t = start(de, 4);
  const [m1] = t.matches;
  const [a, b] = m1.entrants;
  assert.deepEqual(de.progress(t, a), { state: 'waiting', opponent: b, side: 'winners', bracket: 'Winners semi-finals', wins: 0, losses: 0 });
  t.stages[0].status = 'playing';
  assert.equal(de.progress(t, a).state, 'fighting');
  decide(m1, a);
  assert.equal(de.progress(t, a).state, 'through');
  assert.equal(de.progress(t, b).state, 'dropped');
  playStage(de, t);
  assert.equal(de.progress(t, b).side, 'losers');
  playStage(de, t);
  const losersMatch = stageMatches(t, 1).find((m) => m.side === 'losers')!;
  assert.equal(de.progress(t, second(losersMatch)).state, 'out');
  playOut(de, t);
  assert.equal(de.progress(t, t.champion!).state, 'champion');
});

test('double elimination: the losers bracket is drawn when its stage\'s winners bracket is done, and undo takes it back', () => {
  const t = start(de, 8);
  playStage(de, t);
  const stage = currentStage(t)!;
  const winners = stageMatches(t, 1);
  const survivors = [...stage.groups[1].entrants];
  assert.equal(stage.groups[1].pending, true);
  stage.status = 'playing';
  assert.equal(de.progress(t, survivors[0]).state, 'next');
  decide(winners[0], first(winners[0]));
  assert.deepEqual(de.update(t), []);
  decide(winners[1], first(winners[1]));
  assert.equal(stageComplete(t, 1), false);
  assert.equal(de.update(t).length, 2);
  assert.equal(de.progress(t, survivors[0]).state, 'fighting');
  assert.equal(de.progress(t, second(winners[0])).state, 'fighting');
  assert.equal(de.dependents(t, winners[0]).length, 2);
  de.undo(t, winners[0]);
  assert.equal(stageMatches(t, 1).filter((m) => m.side === 'losers').length, 0);
  assert.deepEqual(currentStage(t)!.groups[1].entrants, survivors);
  assert.equal(currentStage(t)!.groups[1].pending, true);
});

test('double elimination: standings put the champion first and the last out next', () => {
  const t = start(de, 8);
  playOut(de, t, randomPick(3));
  const standings = de.standings(t);
  assert.equal(standings[0].entrant, t.champion);
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].rank, 2);
  assert.equal(standings.length, 8);
});

// ---- Single elimination -------------------------------------------------------

const se = singleElimination;

test('single elimination: everyone but the champion loses exactly once', () => {
  for (const n of [2, 3, 5, 8, 13, 16]) {
    const t = start(se, n, n);
    playOut(se, t, randomPick(n));
    for (const id of ids(n)) assert.equal(losses(t, id), id === t.champion ? 0 : 1, `${n} entrants, ${id}`);
    assert.equal(t.matches.length, n - 1);
  }
});

test('single elimination: rounds are named and byes play first next stage', () => {
  const t = start(se, 5);
  assert.equal(t.stages[0].groups[0].name, 'Quarter-finals');
  const bye = t.stages[0].groups[0].bye!;
  assert.ok(bye);
  playStage(se, t);
  assert.equal(t.stages[1].groups[0].entrants[0], bye);
  assert.equal(t.stages[1].groups[0].name, 'Semi-finals');
  playOut(se, t);
  assert.equal(t.stages[t.stages.length - 1].groups[0].name, 'Final');
});

test('single elimination: progress and standings', () => {
  const t = start(se, 4);
  const [m1] = t.matches;
  decide(m1, first(m1));
  assert.equal(se.progress(t, first(m1)).state, 'through');
  assert.equal(se.progress(t, second(m1)).state, 'out');
  playOut(se, t);
  const standings = se.standings(t);
  assert.equal(standings[0].entrant, t.champion);
  assert.deepEqual(standings.map((s) => s.rank), [1, 2, 3, 3]);
  assert.deepEqual(plan(se, 4, { legs: 1 }).map((s) => s.map((g) => g.size)), [[4], [2]]);
});

// ---- Round robin --------------------------------------------------------------

const rr = roundRobin;

test('round robin: every pair meets once per leg, and nobody plays twice in a stage', () => {
  for (const n of [2, 3, 4, 5, 8, 9]) {
    for (const legs of [1, 2]) {
      const t = start(rr, n, n, legs);
      playOut(rr, t, randomPick(n + legs));
      const meetings = new Map<string, number>();
      for (const m of t.matches) {
        const key = [...m.entrants].sort().join('-');
        meetings.set(key, (meetings.get(key) ?? 0) + 1);
      }
      assert.equal(meetings.size, (n * (n - 1)) / 2, `${n} entrants`);
      for (const count of meetings.values()) assert.equal(count, legs);
      for (const stage of t.stages) {
        const playing = stageMatches(t, stage.index).flatMap((m) => m.entrants);
        assert.equal(new Set(playing).size, playing.length, `stage ${stage.index + 1}`);
      }
      assert.equal(t.stages.length, (n % 2 ? n : n - 1) * legs);
    }
  }
});

test('round robin: the second leg swaps sides', () => {
  const t = start(rr, 4, 1, 2);
  playOut(rr, t);
  const firstLeg = t.matches.filter((m) => m.stage < 3).map((m) => m.entrants.join('-'));
  const secondLeg = t.matches.filter((m) => m.stage >= 3).map((m) => [...m.entrants].reverse().join('-'));
  assert.deepEqual([...secondLeg].sort(), [...firstLeg].sort());
});

test('round robin: the table is points, then head to head, then HP margin', () => {
  const t = start(rr, 4, 7);
  // t1 beats everyone. t2 beats t3, t3 beats t4, t4 beats t2: level on one point each.
  const beats = new Set(['t1>t2', 't1>t3', 't1>t4', 't2>t3', 't3>t4', 't4>t2']);
  playOut(rr, t, (m) => (beats.has(`${m.entrants[0]}>${m.entrants[1]}`) ? m.entrants[0] : m.entrants[1]));
  const standings = rr.standings(t);
  assert.equal(t.champion, 't1');
  assert.deepEqual(standings[0], { entrant: 't1', rank: 1, wins: 3, losses: 0, points: 3 });
  // Nothing tells the three apart: no HP recorded, and one head-to-head win each.
  assert.deepEqual(standings.slice(1).map((s) => s.rank), [2, 2, 2]);
  // HP margin breaks it.
  for (const m of t.matches) m.hp = m.entrants.map((id) => (id !== m.winner ? 0 : id === 't3' ? 50 : 10));
  assert.equal(rr.standings(t)[1].entrant, 't3');
  assert.equal(rr.standings(t)[1].rank, 2);
  assert.equal(rr.standings(t)[2].rank, 3);
});

test('round robin: progress', () => {
  const t = start(rr, 3);
  const bye = t.stages[0].groups[0].bye!;
  assert.equal(rr.progress(t, bye).state, 'bye');
  const [m] = t.matches;
  decide(m, first(m));
  assert.equal(rr.progress(t, second(m)).state, 'lost');
  playOut(rr, t);
  const others = ids(3).filter((id) => id !== t.champion);
  for (const id of others) assert.equal(rr.progress(t, id).state, 'out');
});

test('mulberry32 matches the game', () => {
  const random = mulberry32(1);
  assert.deepEqual([random(), random()].map((x) => x.toFixed(6)), ['0.627074', '0.002736']);
});
