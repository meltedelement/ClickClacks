// Round robin: every entrant meets every other `legs` times (the second leg
// swaps sides). Each stage is one round of the schedule, made with the circle
// method from a seeded random order, so nobody plays twice in a stage; with an
// odd count one entrant sits each round out. A win is a point. The table is
// sorted by points, then by wins against the entrants on the same points, then
// by HP margin (HP left minus the opponent's, over every match the game played).
import type { EntrantProgress, Stage, TournamentMatch } from '../../api/tournament.d.ts';
import { shuffled } from '../lib/random.ts';
import { currentStage, decided, newStage, opponent, pairGroup, rank, record, stageComplete, stageMatches } from './common.ts';
import type { Format, FormatState } from './Format.ts';

const KEY = { salt: 0, letter: 'm' };

// The pairs of every round, in order. A null partner is a bye.
function schedule(order: string[], legs: number): [string, string | null][][] {
  const players: (string | null)[] = order.length % 2 === 1 ? [...order, null] : [...order];
  const n = players.length;
  const rest = players.slice(1);
  const rounds: [string, string | null][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const turned = rest.map((_, i) => rest[(i - r + rest.length * n) % rest.length]);
    const line = [players[0], ...turned];
    const pairs: [string | null, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = line[i];
      const b = line[n - 1 - i];
      // The fixed player alternates sides, so nobody is always first.
      pairs.push(i === 0 && r % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(pairs.map(([a, b]) => (a === null ? [b as string, null] : [a, b])));
  }
  const all: [string, string | null][][] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (const round of rounds) all.push(leg % 2 === 0 ? round : round.map(([a, b]) => (b === null ? [a, null] : [b, a])));
  }
  return all;
}

function totalRounds(size: number, legs: number): number {
  return (size % 2 === 1 ? size : size - 1) * legs;
}

function drawRound(t: Pick<FormatState, 'seed' | 'options' | 'entrants'>, index: number): { stage: Stage; matches: TournamentMatch[] } {
  const order = shuffled(t.entrants.map((e) => e.id), t.seed);
  const pairs = schedule(order, t.options.legs)[index];
  const bye = pairs.find(([, b]) => b === null)?.[0];
  const entrants = [...pairs.filter(([, b]) => b !== null).flat(), ...(bye ? [bye] : [])] as string[];
  const { group, matches } = pairGroup('league', `Round ${index + 1}`, entrants, index, t.seed, KEY);
  return { stage: newStage(index, `Stage ${index + 1}`, [group]), matches };
}

export const roundRobin: Format = {
  id: 'round-robin',
  name: 'Round robin',
  description: 'Everyone meets everyone. Each stage is one round of the schedule; a win is a point, and the top of the table wins.',
  options: [{ key: 'legs', description: 'How many times each pair meets (1 or 2). The second meeting swaps sides.', default: 1 }],

  create(entrants, seed, options) {
    if (entrants.length < 2) throw new Error('A tournament needs at least two entrants.');
    const first = drawRound({ seed, options, entrants: entrants.map((id) => ({ id })) }, 0);
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
    const next = stage.index + 1;
    if (next >= totalRounds(t.entrants.length, t.options.legs)) return { champion: roundRobin.standings(t)[0].entrant };
    return drawRound(t, next);
  },

  progress(t, entrant) {
    return progress(t, entrant);
  },

  standings(t) {
    const points = new Map(t.entrants.map(({ id }) => [id, record(t, id).wins]));
    const margin = new Map<string, number>();
    for (const match of t.matches) {
      if (!decided(match) || !match.hp) continue;
      match.entrants.forEach((id, i) => margin.set(id, (margin.get(id) ?? 0) + match.hp![i] - match.hp![1 - i]));
    }
    // Wins against the entrants on the same points.
    const headToHead = (id: string) =>
      t.matches.filter((m) => decided(m) && m.winner === id && points.get(opponent(m, id)) === points.get(id)).length;
    return rank(t, (id) => [points.get(id) ?? 0, headToHead(id), Math.round((margin.get(id) ?? 0) * 1000)]);
  },
};

function progress(t: FormatState, entrant: string): EntrantProgress {
  const { wins, losses } = record(t, entrant);
  const none = { opponent: null, side: null, bracket: null, wins, losses };
  if (t.champion === entrant) return { state: 'champion', ...none };
  if (t.champion) return { state: 'out', ...none };
  const stage = currentStage(t);
  const group = stage?.groups.find((g) => g.entrants.includes(entrant));
  if (!stage || !group) return { state: 'out', ...none };
  const where = { side: group.side, bracket: group.name, wins, losses };
  const match = stageMatches(t, stage.index).find((m) => m.entrants.includes(entrant));
  if (!match) return { state: 'bye', opponent: null, ...where };
  const other = opponent(match, entrant);
  if (decided(match)) return { state: match.winner === entrant ? 'through' : 'lost', opponent: other, ...where };
  return { state: stage.status === 'playing' ? 'fighting' : 'waiting', opponent: other, ...where };
}
