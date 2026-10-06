// Single elimination: out after one loss. The first stage is a seeded random
// draw; each stage pairs the entrants still in, in order (1 v 2, 3 v 4, ...).
// With an odd count the last one gets a bye, and the next stage lists it first,
// so nobody gets two byes in a row.
import type { EntrantProgress, Stage, TournamentMatch } from '../../contracts/tournament.d.ts';
import { shuffled } from '../lib/random.ts';
import { currentStage, decided, knockoutStandings, newStage, opponent, pairGroup, record, stageComplete, stageMatches } from './common.ts';
import type { Format, FormatState } from './Format.ts';

const KEY = { salt: 0, letter: 'm' };

export function knockoutName(size: number, round: number): string {
  if (size <= 2) return 'Final';
  if (size <= 4) return 'Semi-finals';
  if (size <= 8) return 'Quarter-finals';
  return `Round ${round}`;
}

function drawStage(entrants: string[], index: number, seed: number): { stage: Stage; matches: TournamentMatch[] } {
  const { group, matches } = pairGroup('main', knockoutName(entrants.length, index + 1), entrants, index, seed, KEY);
  return { stage: newStage(index, `Stage ${index + 1}`, [group]), matches };
}

export const singleElimination: Format = {
  id: 'single-elimination',
  name: 'Single elimination',
  description: 'Out after one loss. Each stage is one knockout round; an odd entrant out gets a bye and plays first in the next stage.',
  options: [],

  create(entrants, seed) {
    if (entrants.length < 2) throw new Error('A tournament needs at least two entrants.');
    const first = drawStage(shuffled(entrants, seed), 0, seed);
    return { stages: [first.stage], matches: first.matches };
  },

  update() {
    return [];
  },

  dependents() {
    return [];
  },

  undo() {},

  advance(t) {
    const stage = currentStage(t);
    if (!stage || !stageComplete(t, stage.index)) throw new Error('The stage is not finished.');
    const group = stage.groups[0];
    const through = [...(group.bye ? [group.bye] : []), ...stageMatches(t, stage.index).map((m) => m.winner as string)];
    if (through.length === 1) return { champion: through[0] };
    return drawStage(through, stage.index + 1, t.seed);
  },

  progress(t, entrant) {
    return progress(t, entrant);
  },

  standings(t) {
    return knockoutStandings(t, 1);
  },
};

function progress(t: FormatState, entrant: string): EntrantProgress {
  const { wins, losses } = record(t, entrant);
  const none = { opponent: null, side: null, bracket: null, wins, losses };
  if (t.champion === entrant) return { state: 'champion', ...none };
  const stage = currentStage(t);
  const group = stage?.groups.find((g) => g.entrants.includes(entrant));
  // Only the entrants still in are in the current stage's group.
  if (!stage || !group) return { state: 'out', ...none };
  const where = { side: group.side, bracket: group.name, wins, losses };
  const match = stageMatches(t, stage.index).find((m) => m.entrants.includes(entrant));
  if (!match) return { state: 'bye', opponent: null, ...where };
  const other = opponent(match, entrant);
  if (decided(match)) return { state: match.winner === entrant ? 'through' : 'out', opponent: other, ...where };
  return { state: stage.status === 'playing' ? 'fighting' : 'waiting', opponent: other, ...where };
}
