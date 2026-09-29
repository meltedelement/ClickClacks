// Pure battle logic: the double elimination bracket, where each team is in it,
// and whether a loadout is one the game will accept. Shared by the quiz server
// (which queues the matches) and the React pages (which show the bracket), so
// it must not import anything from either side.
//
// The bracket is a double elimination, played in stages. A stage holds the
// matches of one winners bracket round and one losers bracket round, which play
// at the same time. Every team starts in the winners bracket. A loss there
// drops it to the losers bracket, and a loss in the losers bracket puts it out.
//
//   - The first stage is a seeded random draw of all teams into the winners bracket.
//   - Teams in a bracket are paired in order (1 v 2, 3 v 4, ...). With an odd
//     count the last team gets a bye and stays without a match. The next stage
//     lists the bye team first, so it always fights next and never gets two
//     byes in a row (unless it is the only team left in its bracket).
//   - The losers bracket of the next stage pairs its survivors against the
//     teams that just dropped from the winners bracket, then the rest in order.
//   - When each bracket has one team left, they meet in the grand final. The
//     winners bracket champion has not lost yet, so if it loses the grand
//     final, a grand final reset decides the champion.
//
// Every match has a winner: the game breaks a draw on HP (see the tiebreak in
// server/matches.js), and the host can pick one.
import type { Battle, BattleMatch, BattleRound, BracketGroup, BracketSide, Catalog, TeamBattleState } from './types.ts';

// A team as this file needs it.
export interface LoadoutTeam {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
  transformations?: string[];
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

// Each stage has its own random sequence, so a stage drawn again after a
// server restart gets the same match seeds.
function roundRandom(battleSeed: number, round: number) {
  return mulberry32((battleSeed + Math.imul(round + 1, 0x9e3779b9)) >>> 0);
}

const SIDE_LETTER: Record<BracketSide, string> = { winners: 'w', losers: 'l', final: 'f' };

export function winnersName(teamCount: number, round: number): string {
  if (teamCount <= 1) return 'Winners bracket champion';
  if (teamCount <= 2) return 'Winners final';
  if (teamCount <= 4) return 'Winners semi-finals';
  if (teamCount <= 8) return 'Winners quarter-finals';
  return `Winners round ${round}`;
}

// `last` is true when no more teams can drop into the losers bracket after this stage.
export function losersName(teamCount: number, round: number, last: boolean): string {
  if (teamCount <= 1) return 'Losers bracket champion';
  if (teamCount <= 2 && last) return 'Losers final';
  return `Losers round ${round}`;
}

interface GroupSpec {
  side: BracketSide;
  name: string;
  teams: string[];
}

// One stage: pairs the teams of each group in order; an odd team out gets the bye.
export function drawStage(groups: GroupSpec[], index: number, battleSeed: number): { round: BattleRound; matches: BattleMatch[] } {
  const random = roundRandom(battleSeed, index);
  const matches: BattleMatch[] = [];
  const drawn: BracketGroup[] = [];
  for (const { side, name, teams } of groups) {
    if (teams.length === 0) continue;
    let n = 0;
    for (let i = 0; i + 1 < teams.length; i += 2) {
      matches.push({
        id: `s${index + 1}${SIDE_LETTER[side]}${++n}`,
        round: index,
        side,
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
    drawn.push({ side, name, teams: [...teams], bye });
  }
  return { round: { index, name: `Stage ${index + 1}`, groups: drawn, status: 'waiting' }, matches };
}

// The first stage, with the teams in a seeded random order. Needs two teams or more.
export function drawBracket(teamIds: string[], seed: number): { rounds: BattleRound[]; matches: BattleMatch[] } {
  if (teamIds.length < 2) throw new Error('A battle needs at least two teams.');
  const random = mulberry32(seed);
  const order = [...teamIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const first = drawStage([{ side: 'winners', name: winnersName(order.length, 1), teams: order }], 0, seed);
  return { rounds: [first.round], matches: first.matches };
}

export function currentRound(battle: Pick<Battle, 'rounds'>): BattleRound | null {
  return battle.rounds[battle.rounds.length - 1] ?? null;
}

export function roundMatches(battle: Pick<Battle, 'matches'>, round: number): BattleMatch[] {
  return battle.matches.filter((match) => match.round === round);
}

// True when every match in the stage has a winner.
export function roundComplete(battle: Pick<Battle, 'matches'>, round: number): boolean {
  return roundMatches(battle, round).every((match) => match.status === 'done' && match.winner !== null);
}

function loser(match: BattleMatch): string {
  return match.winner === match.a ? match.b : match.a;
}

// Rounds of one bracket played before stage `index`, to number the next one.
function sideRounds(rounds: BattleRound[], side: BracketSide, before: number): number {
  return rounds.slice(0, before).filter((r) => r.groups.some((g) => g.side === side && g.teams.length > 1)).length;
}

// The losers bracket of the next stage: each survivor meets a team that just
// dropped from the winners bracket, and the teams left over play each other.
function losersOrder(survivors: string[], dropped: string[]): string[] {
  const order: string[] = [];
  const n = Math.min(survivors.length, dropped.length);
  for (let i = 0; i < n; i++) order.push(survivors[i], dropped[i]);
  order.push(...survivors.slice(n), ...dropped.slice(n));
  return order;
}

// What comes after a complete stage: the next stage, or the champion.
export function advance(battle: Pick<Battle, 'rounds' | 'matches' | 'seed'>):
  | { champion: string }
  | { round: BattleRound; matches: BattleMatch[] } {
  const round = currentRound(battle);
  if (!round || !roundComplete(battle, round.index)) throw new Error('The stage is not finished.');
  const matches = roundMatches(battle, round.index);
  const next = round.index + 1;

  const final = matches.find((m) => m.side === 'final');
  if (final) {
    const winner = final.winner as string;
    // The winners bracket champion (a) won, or this was already the reset.
    if (winner === final.a || sideRounds(battle.rounds, 'final', round.index) > 0) return { champion: winner };
    return drawStage([{ side: 'final', name: 'Grand final reset', teams: [final.a, final.b] }], next, battle.seed);
  }

  const group = (side: BracketSide) => round.groups.find((g) => g.side === side);
  const played = (side: BracketSide) => matches.filter((m) => m.side === side);
  const winnersBye = group('winners')?.bye;
  const losersBye = group('losers')?.bye;
  const winners = [...(winnersBye ? [winnersBye] : []), ...played('winners').map((m) => m.winner as string)];
  const dropped = played('winners').map(loser);
  const losers = losersOrder([...(losersBye ? [losersBye] : []), ...played('losers').map((m) => m.winner as string)], dropped);

  if (winners.length === 1 && losers.length === 1) {
    return drawStage([{ side: 'final', name: 'Grand final', teams: [winners[0], losers[0]] }], next, battle.seed);
  }
  if (losers.length === 0) return { champion: winners[0] }; // cannot happen with two teams or more
  const lastLosers = winners.length <= 1; // no winners match this stage, so nobody drops into the losers bracket
  return drawStage(
    [
      { side: 'winners', name: winnersName(winners.length, sideRounds(battle.rounds, 'winners', next) + 1), teams: winners },
      { side: 'losers', name: losersName(losers.length, sideRounds(battle.rounds, 'losers', next) + 1, lastLosers), teams: losers },
    ],
    next,
    battle.seed,
  );
}

export interface PlannedGroup {
  side: BracketSide;
  name: string;
  size: number; // teams
}

// The shape of the whole bracket for `teams` teams, stage by stage, as if the
// first team of every match wins (so without a grand final reset). The shape
// does not depend on who wins, so the pages use it to show the stages that are
// not drawn yet.
export function plannedStages(teams: number): PlannedGroup[][] {
  if (teams < 2) return [];
  const battle: Pick<Battle, 'rounds' | 'matches' | 'seed'> = { seed: 0, ...drawBracket(Array.from({ length: teams }, (_, i) => `t${i}`), 0) };
  for (;;) {
    const round = currentRound(battle)!;
    for (const m of roundMatches(battle, round.index)) Object.assign(m, { status: 'done', winner: m.a });
    const next = advance(battle);
    if ('champion' in next) break;
    battle.rounds.push(next.round);
    battle.matches.push(...next.matches);
  }
  return battle.rounds.map((r) => r.groups.map((g) => ({ side: g.side, name: g.name, size: g.teams.length })));
}

// Matches the team lost.
export function lossCount(battle: Pick<Battle, 'matches'>, teamId: string): number {
  return battle.matches.filter((m) => m.status === 'done' && m.winner !== null && m.winner !== teamId && (m.a === teamId || m.b === teamId)).length;
}

export interface TeamProgress {
  state: TeamBattleState;
  opponent: string | null; // a team id
  side: BracketSide | null; // the team's bracket in this stage
  bracket: string | null; // the name of the team's bracket in this stage
  losses: number;
}

// Where one team is now.
export function teamProgress(battle: Pick<Battle, 'rounds' | 'matches' | 'champion'>, teamId: string): TeamProgress {
  const losses = lossCount(battle, teamId);
  if (battle.champion === teamId) return { state: 'champion', opponent: null, side: null, bracket: null, losses };
  const round = currentRound(battle);
  const group = round?.groups.find((g) => g.teams.includes(teamId));
  if (!round || !group) return { state: 'out', opponent: null, side: null, bracket: null, losses };
  const where = { side: group.side, bracket: group.name, losses };
  const match = roundMatches(battle, round.index).find((m) => m.a === teamId || m.b === teamId);
  if (!match) return { state: group.bye === teamId ? 'bye' : 'out', opponent: null, ...where };
  const opponent = match.a === teamId ? match.b : match.a;
  if (match.status === 'done' && match.winner !== null) {
    if (match.winner === teamId) return { state: 'through', opponent, ...where };
    // Only a loss in the winners bracket, or a first loss in the grand final, keeps the team in.
    return { state: losses >= 2 ? 'out' : 'dropped', opponent, ...where };
  }
  return { state: round.status === 'playing' ? 'fighting' : 'waiting', opponent, ...where };
}

// True while the team can still win the battle.
export function stillIn(battle: Pick<Battle, 'rounds' | 'matches' | 'champion'>, teamId: string): boolean {
  if (battle.champion) return false;
  return teamProgress(battle, teamId).state !== 'out';
}

// Transformations the team can still take: they fit the weapon, the team does
// not have them, and it has what they require.
export function eligibleTransformations(team: LoadoutTeam, catalog: Catalog): string[] {
  const picked = team.transformations ?? [];
  const owned = new Set([...picked, ...Object.keys(team.upgrades).filter((id) => (team.upgrades[id] ?? 0) > 0)]);
  return catalog.transformations
    .filter(
      (t) =>
        (!t.weapons || t.weapons.includes(team.weapon)) &&
        picked.filter((id) => id === t.id).length < (t.maxStacks ?? Infinity) &&
        (t.requires ?? []).every((id) => owned.has(id)),
    )
    .map((t) => t.id);
}

// Why the game would reject this loadout, as a list of short strings. Mirrors
// the game's resolveUpgrades (src/upgrades/index.js) and the match API's split
// of upgrades and transformations (server/matches.js), so the host hears about
// a bad loadout before the match is queued, not as a 400 from the API.
export function validateLoadout(team: LoadoutTeam, catalog: Catalog): string[] {
  const problems: string[] = [];
  const upgrades = new Map(catalog.upgrades.map((u) => [u.id, u]));
  const transformations = new Map(catalog.transformations.map((u) => [u.id, u]));
  if (!catalog.weapons.some((w) => w.id === team.weapon)) problems.push(`unknown weapon "${team.weapon}"`);
  const picked = team.transformations ?? [];
  const entries = [
    ...Object.entries(team.upgrades).map(([id, count]) => ({ id, count, transformation: false })),
    ...[...new Set(picked)].map((id) => ({ id, count: picked.filter((x) => x === id).length, transformation: true })),
  ].filter((e) => e.count > 0);
  const owned = entries.map((e) => e.id);
  for (const { id, count, transformation } of entries) {
    const upgrade = (transformation ? transformations : upgrades).get(id);
    if (!upgrade) {
      if ((transformation ? upgrades : transformations).has(id)) problems.push(`"${id}" is ${transformation ? 'not ' : ''}a transformation`);
      else problems.push(`unknown ${transformation ? 'transformation' : 'upgrade'} "${id}"`);
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
