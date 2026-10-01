// Helpers every format uses: pairing a group, reading the current stage,
// counting wins and losses, and planning a tournament's shape.
import type { FormatOptions, Group, PlannedGroup, Stage, Standing, TournamentMatch } from '../../api/tournament.d.ts';
import { mulberry32 } from '../lib/random.ts';
import type { Format, FormatState } from './Format.ts';

// Each group of each stage has its own random sequence, so a group drawn again
// (after a restart, or a draw taken back) gets the same match seeds. `salt`
// tells the groups of one stage apart.
export function groupRandom(seed: number, stage: number, salt: number) {
  return mulberry32((seed + Math.imul(stage + 1, 0x9e3779b9) + Math.imul(salt, 0x85ebca6b)) >>> 0);
}

export function newMatch(id: string, stage: number, side: string, a: string, b: string, seed: number): TournamentMatch {
  return {
    id,
    stage,
    side,
    entrants: [a, b],
    seed,
    status: 'pending',
    gameMatchId: null,
    screen: null,
    fighters: null,
    winner: null,
    decidedBy: null,
    hp: null,
    time: null,
  };
}

// One group of a stage: pairs the entrants in order; an odd one out gets the bye.
// Match ids are `s<stage><letter><n>`, e.g. "s2w1".
export function pairGroup(
  side: string,
  name: string,
  entrants: string[],
  stage: number,
  seed: number,
  { salt, letter }: { salt: number; letter: string },
): { group: Group; matches: TournamentMatch[] } {
  const random = groupRandom(seed, stage, salt);
  const matches: TournamentMatch[] = [];
  for (let i = 0; i + 1 < entrants.length; i += 2) {
    matches.push(newMatch(`s${stage + 1}${letter}${matches.length + 1}`, stage, side, entrants[i], entrants[i + 1], Math.floor(random() * 2 ** 32)));
  }
  const bye = entrants.length % 2 === 1 ? entrants[entrants.length - 1] : null;
  return { group: { side, name, entrants: [...entrants], bye }, matches };
}

export function newStage(index: number, name: string, groups: Group[]): Stage {
  return { index, name, groups, status: 'waiting' };
}

export function currentStage(t: Pick<FormatState, 'stages'>): Stage | null {
  return t.stages[t.stages.length - 1] ?? null;
}

export function stageMatches(t: Pick<FormatState, 'matches'>, stage: number): TournamentMatch[] {
  return t.matches.filter((match) => match.stage === stage);
}

export const decided = (match: TournamentMatch) => match.status === 'done' && match.winner !== null;

// True when every match in the stage has a winner and nothing in it waits to be drawn.
export function stageComplete(t: Pick<FormatState, 'stages' | 'matches'>, stage: number): boolean {
  if (t.stages[stage]?.groups.some((g) => g.pending)) return false;
  return stageMatches(t, stage).every(decided);
}

export function loser(match: TournamentMatch): string {
  return match.winner === match.entrants[0] ? match.entrants[1] : match.entrants[0];
}

export function opponent(match: TournamentMatch, entrant: string): string {
  return match.entrants[0] === entrant ? match.entrants[1] : match.entrants[0];
}

export function record(t: Pick<FormatState, 'matches'>, entrant: string): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const match of t.matches) {
    if (!decided(match) || !match.entrants.includes(entrant)) continue;
    if (match.winner === entrant) wins++;
    else losses++;
  }
  return { wins, losses };
}

// Standings for a knockout format: the champion, then whoever is still in
// (fewest losses first), then the rest by how late they went out. Entrants that
// went out in the same stage share a rank.
export function knockoutStandings(t: FormatState, lives: number): Standing[] {
  const outAt = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const match of t.matches) {
    if (!decided(match)) continue;
    const id = loser(match);
    const n = (losses.get(id) ?? 0) + 1;
    losses.set(id, n);
    if (n >= lives && id !== t.champion) outAt.set(id, match.stage);
  }
  const key = (id: string): number[] => {
    if (id === t.champion) return [3, 0];
    if (!outAt.has(id)) return [2, -(losses.get(id) ?? 0)];
    return [1, outAt.get(id)!];
  };
  return rank(t, key);
}

// Sorts the entrants by `key` (bigger is better, compared in order) and gives
// equal keys the same rank.
export function rank(t: FormatState, key: (id: string) => number[]): Standing[] {
  const rows = t.entrants.map(({ id }, order) => ({ id, order, key: key(id), ...record(t, id) }));
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  rows.sort((a, b) => compare(a.key, b.key) || a.order - b.order);
  let place = 0;
  return rows.map((row, i) => {
    if (i === 0 || compare(rows[i - 1].key, row.key) !== 0) place = i + 1;
    return { entrant: row.id, rank: place, wins: row.wins, losses: row.losses, points: row.wins };
  });
}

// The shape of a whole tournament for `size` entrants, stage by stage, as if
// the first entrant of every match wins. The shape of the formats here does not
// depend on who wins (except a grand final reset, which this leaves out), so
// callers can show the stages that are not drawn yet.
export function plan(format: Format, size: number, options: Required<FormatOptions>): PlannedGroup[][] {
  if (size < 2) return [];
  const entrants = Array.from({ length: size }, (_, i) => `e${i}`);
  const t: FormatState = { seed: 0, options, entrants: entrants.map((id) => ({ id })), champion: null, ...format.create(entrants, 0, options) };
  const win = (matches: TournamentMatch[]) => matches.forEach((m) => Object.assign(m, { status: 'done', winner: m.entrants[0] }));
  for (let guard = 0; guard < 10_000; guard++) {
    const stage = currentStage(t)!;
    win(stageMatches(t, stage.index));
    for (let more = format.update(t); more.length > 0; more = format.update(t)) win(more);
    stage.status = 'done';
    const next = format.advance(t);
    if ('champion' in next) break;
    t.stages.push(next.stage);
    t.matches.push(...next.matches);
  }
  return t.stages.map((s) => s.groups.map((g) => ({ side: g.side, name: g.name, size: g.entrants.length })));
}
