// Double elimination, played in stages. A stage holds one winners bracket
// round and then one losers bracket round. Every entrant starts in the winners
// bracket. A loss there drops it to the losers bracket of the same stage, and a
// loss in the losers bracket puts it out.
//
//   - The first stage is a seeded random draw of all entrants into the winners bracket.
//   - The losers bracket round of a stage is drawn when the winners bracket
//     round of that stage is finished (`update`), because it needs the entrants
//     that just dropped. Until then its group is `pending` and holds only the
//     survivors of the losers bracket. So the two brackets never play at the
//     same time.
//   - Entrants in a bracket are paired in order (1 v 2, 3 v 4, ...). With an odd
//     count the last one gets a bye. The next stage lists the bye first, so it
//     always fights next and never gets two byes in a row (unless it is the
//     only one left in its bracket).
//   - The losers bracket pairs its survivors against the entrants that just
//     dropped from the winners bracket, then the rest in order.
//   - When each bracket has one entrant left, they meet in the grand final. The
//     winners bracket champion has not lost yet, so if it loses the grand
//     final, a grand final reset decides the champion.
import type { EntrantProgress, Group, Stage, TournamentMatch } from '../../contracts/tournament.d.ts';
import { shuffled } from '../lib/random.ts';
import { currentStage, decided, knockoutStandings, loser, newStage, opponent, pairGroup, record, stageComplete, stageMatches } from './common.ts';
import type { Format, FormatState } from './Format.ts';

type Side = 'winners' | 'losers' | 'final';

const GROUP_KEYS: Record<Side, { salt: number; letter: string }> = {
  winners: { salt: 0, letter: 'w' },
  losers: { salt: 1, letter: 'l' },
  final: { salt: 2, letter: 'f' },
};

export function winnersName(size: number, round: number): string {
  if (size <= 1) return 'Winners bracket champion';
  if (size <= 2) return 'Winners final';
  if (size <= 4) return 'Winners semi-finals';
  if (size <= 8) return 'Winners quarter-finals';
  return `Winners round ${round}`;
}

// `last` is true when no more entrants can drop into the losers bracket after this stage.
export function losersName(size: number, round: number, last: boolean): string {
  if (size <= 1) return 'Losers bracket champion';
  if (size <= 2 && last) return 'Losers final';
  return `Losers round ${round}`;
}

interface GroupSpec {
  side: Side;
  name: string;
  entrants: string[];
  pending?: boolean;
}

// One stage. A pending group is only kept; `update` draws it later.
function drawStage(specs: GroupSpec[], index: number, seed: number): { stage: Stage; matches: TournamentMatch[] } {
  const matches: TournamentMatch[] = [];
  const groups: Group[] = [];
  for (const { side, name, entrants, pending } of specs) {
    if (pending) {
      groups.push({ side, name, entrants: [...entrants], bye: null, pending: true });
      continue;
    }
    if (entrants.length === 0) continue;
    const drawn = pairGroup(side, name, entrants, index, seed, GROUP_KEYS[side]);
    groups.push(drawn.group);
    matches.push(...drawn.matches);
  }
  return { stage: newStage(index, `Stage ${index + 1}`, groups), matches };
}

// Rounds of one bracket played before stage `before`, to number the next one.
function sideRounds(stages: Stage[], side: Side, before: number): number {
  return stages.slice(0, before).filter((s) => s.groups.some((g) => g.side === side && g.entrants.length > 1)).length;
}

// A losers bracket group that waits for the winners bracket of its stage. It
// gets its real name when it is drawn and its size is known.
function pendingLosers(stages: Stage[], index: number, survivors: string[]): GroupSpec {
  return { side: 'losers', name: `Losers round ${sideRounds(stages, 'losers', index) + 1}`, entrants: survivors, pending: true };
}

// The losers bracket of a stage: each survivor meets an entrant that just
// dropped from the winners bracket, and the ones left over play each other.
function losersOrder(survivors: string[], dropped: string[]): string[] {
  const order: string[] = [];
  const n = Math.min(survivors.length, dropped.length);
  for (let i = 0; i < n; i++) order.push(survivors[i], dropped[i]);
  order.push(...survivors.slice(n), ...dropped.slice(n));
  return order;
}

export const doubleElimination: Format = {
  id: 'double-elimination',
  name: 'Double elimination',
  description:
    'Out after two losses. A loss in the winners bracket drops the entrant to the losers bracket; the two bracket winners meet in the grand final, with a reset if the losers bracket side wins it. Each stage plays one winners round, then one losers round.',
  options: [],

  create(entrants, seed) {
    if (entrants.length < 2) throw new Error('A tournament needs at least two entrants.');
    const order = shuffled(entrants, seed);
    const first = drawStage([{ side: 'winners', name: winnersName(order.length, 1), entrants: order }, pendingLosers([], 0, [])], 0, seed);
    return { stages: [first.stage], matches: first.matches };
  },

  // When the winners bracket of the current stage is finished, the entrants
  // that dropped from it join the survivors of the losers bracket, and the
  // losers bracket of the stage is drawn.
  update(t) {
    const stage = currentStage(t);
    const at = stage ? stage.groups.findIndex((g) => g.side === 'losers' && g.pending) : -1;
    if (!stage || at < 0) return [];
    const winners = stageMatches(t, stage.index).filter((m) => m.side === 'winners');
    if (!winners.every(decided)) return [];
    const entrants = losersOrder(stage.groups[at].entrants, winners.map(loser));
    // After a winners final, nobody else can drop into the losers bracket.
    const last = (stage.groups.find((g) => g.side === 'winners')?.entrants.length ?? 0) <= 2;
    const name = losersName(entrants.length, sideRounds(t.stages, 'losers', stage.index) + 1, last);
    const { group, matches } = pairGroup('losers', name, entrants, stage.index, t.seed, GROUP_KEYS.losers);
    stage.groups[at] = group;
    t.matches.push(...matches);
    return matches;
  },

  // A winners match decides who drops into the losers bracket of its stage.
  dependents(t, match) {
    if (match.side !== 'winners' || t.stages[match.stage] !== currentStage(t)) return [];
    return stageMatches(t, match.stage).filter((m) => m.side === 'losers');
  },

  // Takes back the losers bracket draw of the current stage; the survivors stay.
  undo(t, match) {
    if (match.side !== 'winners') return;
    const stage = currentStage(t);
    const at = stage ? stage.groups.findIndex((g) => g.side === 'losers' && !g.pending) : -1;
    const winners = stage?.groups.find((g) => g.side === 'winners');
    // A losers bracket is only drawn late when the stage has a winners match.
    if (!stage || at < 0 || !winners || winners.entrants.length < 2 || match.stage !== stage.index) return;
    const survivors = stage.groups[at].entrants.filter((id) => !winners.entrants.includes(id));
    const pending = pendingLosers(t.stages, stage.index, survivors);
    stage.groups[at] = { side: pending.side, name: pending.name, entrants: pending.entrants, bye: null, pending: true };
    t.matches = t.matches.filter((m) => !(m.stage === stage.index && m.side === 'losers'));
  },

  advance(t) {
    const stage = currentStage(t);
    if (!stage || !stageComplete(t, stage.index)) throw new Error('The stage is not finished.');
    const matches = stageMatches(t, stage.index);
    const next = stage.index + 1;

    const final = matches.find((m) => m.side === 'final');
    if (final) {
      const winner = final.winner as string;
      // The winners bracket champion (first) won, or this was already the reset.
      if (winner === final.entrants[0] || sideRounds(t.stages, 'final', stage.index) > 0) return { champion: winner };
      return drawStage([{ side: 'final', name: 'Grand final reset', entrants: [...final.entrants] }], next, t.seed);
    }

    const group = (side: Side) => stage.groups.find((g) => g.side === side);
    const played = (side: Side) => matches.filter((m) => m.side === side);
    // The byes go first, so they fight in the next stage.
    const through = (side: Side) => {
      const bye = group(side)?.bye;
      return [...(bye ? [bye] : []), ...played(side).map((m) => m.winner as string)];
    };
    const winners = through('winners');
    const losers = through('losers'); // the entrants that dropped this stage are in it already

    if (winners.length === 1 && losers.length === 1) {
      return drawStage([{ side: 'final', name: 'Grand final', entrants: [winners[0], losers[0]] }], next, t.seed);
    }
    if (losers.length === 0) return { champion: winners[0] }; // cannot happen with two entrants or more
    const winnersGroup: GroupSpec = { side: 'winners', name: winnersName(winners.length, sideRounds(t.stages, 'winners', next) + 1), entrants: winners };
    // With a winners match, entrants drop into the losers bracket, so it waits
    // for them. Without one, the losers bracket plays at once, and it is the
    // last round before its final (or the final).
    const losersGroup: GroupSpec =
      winners.length > 1
        ? pendingLosers(t.stages, next, losers)
        : { side: 'losers', name: losersName(losers.length, sideRounds(t.stages, 'losers', next) + 1, true), entrants: losers };
    return drawStage([winnersGroup, losersGroup], next, t.seed);
  },

  progress(t, entrant) {
    return progress(t, entrant);
  },

  standings(t) {
    return knockoutStandings(t, 2);
  },
};

function progress(t: FormatState, entrant: string): EntrantProgress {
  const { wins, losses } = record(t, entrant);
  const none = { opponent: null, side: null, bracket: null, wins, losses };
  if (t.champion === entrant) return { state: 'champion', ...none };
  const stage = currentStage(t);
  // An entrant that dropped from the winners bracket is in both groups of the
  // stage once the losers bracket is drawn. The last group is where it is now.
  const group = stage?.groups.filter((g) => g.entrants.includes(entrant)).pop();
  if (!stage || !group) return { state: 'out', ...none };
  const where = { side: group.side, bracket: group.name, wins, losses };
  if (group.pending) return { state: 'next', opponent: null, ...where };
  const match = stageMatches(t, stage.index).find((m) => m.side === group.side && m.entrants.includes(entrant));
  if (!match) return { state: group.bye === entrant ? 'bye' : 'out', opponent: null, ...where };
  const other = opponent(match, entrant);
  if (decided(match)) {
    if (match.winner === entrant) return { state: 'through', opponent: other, ...where };
    // Only a loss in the winners bracket, or a first loss in the grand final, keeps the entrant in.
    return { state: losses >= 2 ? 'out' : 'dropped', opponent: other, ...where };
  }
  return { state: stage.status === 'playing' ? 'fighting' : 'waiting', opponent: other, ...where };
}
