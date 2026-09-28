// Pure battle logic: the knockout bracket, where each team is in it, and
// whether a loadout is one the game will accept. Shared by the quiz server
// (which queues the matches) and the React pages (which show the bracket), so
// it must not import anything from either side.
//
// The bracket: the first round is a seeded random draw. Teams are paired in
// order (1 v 2, 3 v 4, ...). With an odd count the last team gets a bye and
// goes through without a match. The next round lists the bye team first, then
// the winners in match order, so the team with a bye always fights next round
// and never gets two byes in a row. Every match has a winner: the game breaks a
// draw on HP (see the tiebreak in server/matches.js), and the host can pick one.
import type { Battle, BattleMatch, BattleRound, Catalog, TeamBattleState } from './types.ts';

// A team as this file needs it.
export interface LoadoutTeam {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
}

// Seeded random numbers in [0, 1). The same PRNG as the game (src/sim/random.js).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each round has its own random sequence, so a round drawn again after a
// server restart gets the same match seeds.
function roundRandom(battleSeed: number, round: number) {
  return mulberry32((battleSeed + Math.imul(round + 1, 0x9e3779b9)) >>> 0);
}

export function roundName(teamCount: number, index: number): string {
  if (teamCount <= 2) return 'Final';
  if (teamCount <= 4) return 'Semi-finals';
  if (teamCount <= 8) return 'Quarter-finals';
  return `Round ${index + 1}`;
}

// One round: pairs `teams` in order; an odd team out gets the bye.
export function drawRound(teams: string[], index: number, battleSeed: number): { round: BattleRound; matches: BattleMatch[] } {
  const random = roundRandom(battleSeed, index);
  const matches: BattleMatch[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    matches.push({
      id: `r${index + 1}m${matches.length + 1}`,
      round: index,
      a: teams[i],
      b: teams[i + 1],
      seed: Math.floor(random() * 2 ** 32),
      gameId: null,
      status: 'pending',
      fighters: null,
      winner: null,
      decidedBy: null,
      hp: null,
      time: null,
    });
  }
  const bye = teams.length % 2 === 1 ? teams[teams.length - 1] : null;
  return { round: { index, name: roundName(teams.length, index), teams: [...teams], bye, status: 'waiting' }, matches };
}

// The first round, with the teams in a seeded random order. Needs two teams or more.
export function drawBracket(teamIds: string[], seed: number): { rounds: BattleRound[]; matches: BattleMatch[] } {
  if (teamIds.length < 2) throw new Error('A knockout needs at least two teams.');
  const random = mulberry32(seed);
  const order = [...teamIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const first = drawRound(order, 0, seed);
  return { rounds: [first.round], matches: first.matches };
}

export function currentRound(battle: Pick<Battle, 'rounds'>): BattleRound | null {
  return battle.rounds[battle.rounds.length - 1] ?? null;
}

export function roundMatches(battle: Pick<Battle, 'matches'>, round: number): BattleMatch[] {
  return battle.matches.filter((match) => match.round === round);
}

// True when every match in the round has a winner.
export function roundComplete(battle: Pick<Battle, 'matches'>, round: number): boolean {
  return roundMatches(battle, round).every((match) => match.status === 'done' && match.winner !== null);
}

// What comes after a complete round: the next round, or the champion.
export function advance(battle: Pick<Battle, 'rounds' | 'matches' | 'seed'>):
  | { champion: string }
  | { round: BattleRound; matches: BattleMatch[] } {
  const round = currentRound(battle);
  if (!round || !roundComplete(battle, round.index)) throw new Error('The round is not finished.');
  const winners = roundMatches(battle, round.index).map((match) => match.winner as string);
  const through = round.bye ? [round.bye, ...winners] : winners;
  if (through.length === 1) return { champion: through[0] };
  return drawRound(through, round.index + 1, battle.seed);
}

// Where one team is now. `opponent` is a team id.
export function teamProgress(battle: Pick<Battle, 'rounds' | 'matches' | 'champion'>, teamId: string): { state: TeamBattleState; opponent: string | null } {
  if (battle.champion === teamId) return { state: 'champion', opponent: null };
  const lost = battle.matches.some((m) => m.status === 'done' && m.winner !== null && m.winner !== teamId && (m.a === teamId || m.b === teamId));
  if (lost) return { state: 'out', opponent: null };
  const round = currentRound(battle);
  if (!round || !round.teams.includes(teamId)) return { state: 'out', opponent: null };
  if (round.bye === teamId) return { state: 'bye', opponent: null };
  const match = roundMatches(battle, round.index).find((m) => m.a === teamId || m.b === teamId);
  if (!match) return { state: 'out', opponent: null };
  const opponent = match.a === teamId ? match.b : match.a;
  if (match.status === 'done') return { state: 'through', opponent };
  return { state: round.status === 'playing' ? 'fighting' : 'waiting', opponent };
}

// Why the game would reject this loadout, as a list of short strings. Mirrors
// the game's resolveUpgrades (src/upgrades/index.js) so the host hears about a
// bad loadout before the match is queued, not as a 400 from the API.
export function validateLoadout(team: LoadoutTeam, catalog: Catalog): string[] {
  const problems: string[] = [];
  const upgrades = new Map(catalog.upgrades.map((u) => [u.id, u]));
  if (!catalog.weapons.some((w) => w.id === team.weapon)) problems.push(`unknown weapon "${team.weapon}"`);
  const owned = Object.keys(team.upgrades).filter((id) => (team.upgrades[id] ?? 0) > 0);
  for (const [id, count] of Object.entries(team.upgrades)) {
    if (!(count > 0)) continue;
    const upgrade = upgrades.get(id);
    if (!upgrade) {
      problems.push(`unknown upgrade "${id}"`);
      continue;
    }
    if (upgrade.weapons && !upgrade.weapons.includes(team.weapon)) problems.push(`"${id}" does not fit ${team.weapon}`);
    if (upgrade.maxStacks !== undefined && count > upgrade.maxStacks) {
      problems.push(`"${id}" ×${count} is over its limit of ${upgrade.maxStacks}`);
    }
    const missing = (upgrade.requires ?? []).filter((required) => !owned.includes(required));
    if (missing.length > 0) problems.push(`"${id}" needs ${missing.map((required) => `"${required}"`).join(', ')}`);
  }
  return problems;
}
