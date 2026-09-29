// Pure battle logic: the double elimination bracket, where each team is in it,
// and whether a loadout is one the game will accept. Shared by the quiz server
// (which queues the matches) and the React pages (which show the bracket), so
// it must not import anything from either side.
//
// The bracket is a double elimination, played in stages. A stage holds one
// winners bracket round and then one losers bracket round. Every team starts in
// the winners bracket. A loss there drops it to the losers bracket of the same
// stage, and a loss in the losers bracket puts it out.
//
//   - The first stage is a seeded random draw of all teams into the winners bracket.
//   - The losers bracket round of a stage is drawn when the winners bracket
//     round of that stage is finished (see drawLosers), because it needs the
//     teams that just dropped. Until then its group is `pending` and holds only
//     the survivors of the losers bracket. So the two brackets never play at
//     the same time.
//   - Teams in a bracket are paired in order (1 v 2, 3 v 4, ...). With an odd
//     count the last team gets a bye and stays without a match. The next stage
//     lists the bye team first, so it always fights next and never gets two
//     byes in a row (unless it is the only team left in its bracket).
//   - The losers bracket pairs its survivors against the teams that just
//     dropped from the winners bracket, then the rest in order.
//   - When each bracket has one team left, they meet in the grand final. The
//     winners bracket champion has not lost yet, so if it loses the grand
//     final, a grand final reset decides the champion.
//
// Every match has a winner: the game breaks a draw on HP (see the tiebreak in
// server/matches.js), and the host can pick one.
import type { Battle, BattleMatch, BattleRound, BracketGroup, BracketSide, Catalog, TeamBattleState, Upgrade } from './types.ts';

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

const SIDE_LETTER: Record<BracketSide, string> = { winners: 'w', losers: 'l', final: 'f' };
const SIDE_NUMBER: Record<BracketSide, number> = { winners: 0, losers: 1, final: 2 };

// Each bracket of each stage has its own random sequence, so a bracket drawn
// again (after a server restart, or a losers draw taken back) gets the same
// match seeds.
function groupRandom(battleSeed: number, round: number, side: BracketSide) {
  return mulberry32((battleSeed + Math.imul(round + 1, 0x9e3779b9) + Math.imul(SIDE_NUMBER[side], 0x85ebca6b)) >>> 0);
}

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
  pending?: boolean; // a losers bracket that waits for the winners bracket of its stage
}

// One bracket of a stage: pairs the teams in order; an odd team out gets the bye.
function drawGroup(side: BracketSide, name: string, teams: string[], index: number, battleSeed: number): { group: BracketGroup; matches: BattleMatch[] } {
  const random = groupRandom(battleSeed, index, side);
  const matches: BattleMatch[] = [];
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
  return { group: { side, name, teams: [...teams], bye }, matches };
}

// One stage. A pending group is only kept; drawLosers draws it later.
export function drawStage(groups: GroupSpec[], index: number, battleSeed: number): { round: BattleRound; matches: BattleMatch[] } {
  const matches: BattleMatch[] = [];
  const drawn: BracketGroup[] = [];
  for (const { side, name, teams, pending } of groups) {
    if (pending) {
      drawn.push({ side, name, teams: [...teams], bye: null, pending: true });
      continue;
    }
    if (teams.length === 0) continue;
    const group = drawGroup(side, name, teams, index, battleSeed);
    drawn.push(group.group);
    matches.push(...group.matches);
  }
  return { round: { index, name: `Stage ${index + 1}`, groups: drawn, status: 'waiting' }, matches };
}

// A losers bracket group that waits for the winners bracket of its stage. It
// gets its real name when it is drawn and its size is known.
function pendingLosers(rounds: BattleRound[], index: number, survivors: string[]): GroupSpec {
  return { side: 'losers', name: `Losers round ${sideRounds(rounds, 'losers', index) + 1}`, teams: survivors, pending: true };
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
  const first = drawStage([{ side: 'winners', name: winnersName(order.length, 1), teams: order }, pendingLosers([], 0, [])], 0, seed);
  return { rounds: [first.round], matches: first.matches };
}

export function currentRound(battle: Pick<Battle, 'rounds'>): BattleRound | null {
  return battle.rounds[battle.rounds.length - 1] ?? null;
}

export function roundMatches(battle: Pick<Battle, 'matches'>, round: number): BattleMatch[] {
  return battle.matches.filter((match) => match.round === round);
}

const decided = (match: BattleMatch) => match.status === 'done' && match.winner !== null;

// True when every match in the stage has a winner and its losers bracket is drawn.
export function roundComplete(battle: Pick<Battle, 'rounds' | 'matches'>, round: number): boolean {
  if (battle.rounds[round]?.groups.some((g) => g.pending)) return false;
  return roundMatches(battle, round).every(decided);
}

// When the winners bracket of the current stage is finished, the teams that
// dropped from it join the survivors of the losers bracket, and the losers
// bracket of the stage is drawn. Changes `battle` in place and returns the new
// matches (none when there is nothing to draw yet).
export function drawLosers(battle: Pick<Battle, 'rounds' | 'matches' | 'seed'>): BattleMatch[] {
  const round = currentRound(battle);
  const at = round ? round.groups.findIndex((g) => g.side === 'losers' && g.pending) : -1;
  if (!round || at < 0) return [];
  const winners = roundMatches(battle, round.index).filter((m) => m.side === 'winners');
  if (!winners.every(decided)) return [];
  const teams = losersOrder(round.groups[at].teams, winners.map(loser));
  // After a winners final, nobody else can drop into the losers bracket.
  const last = (round.groups.find((g) => g.side === 'winners')?.teams.length ?? 0) <= 2;
  const name = losersName(teams.length, sideRounds(battle.rounds, 'losers', round.index) + 1, last);
  const { group, matches } = drawGroup('losers', name, teams, round.index, battle.seed);
  round.groups[at] = group;
  battle.matches.push(...matches);
  return matches;
}

// Takes back the losers bracket draw of the current stage, because a winners
// match of the stage is played or decided again and can drop another team.
// The caller makes sure that no losers match of the stage has started.
// Changes `battle` in place.
export function undrawLosers(battle: Pick<Battle, 'rounds' | 'matches'>) {
  const round = currentRound(battle);
  const at = round ? round.groups.findIndex((g) => g.side === 'losers' && !g.pending) : -1;
  const winners = round?.groups.find((g) => g.side === 'winners');
  // A losers bracket is only drawn late when the stage has a winners match.
  if (!round || at < 0 || !winners || winners.teams.length < 2) return;
  const survivors = round.groups[at].teams.filter((id) => !winners.teams.includes(id));
  round.groups[at] = { ...pendingLosers(battle.rounds, round.index, survivors), bye: null, pending: true };
  for (let i = battle.matches.length - 1; i >= 0; i--) {
    if (battle.matches[i].round === round.index && battle.matches[i].side === 'losers') battle.matches.splice(i, 1);
  }
}

function loser(match: BattleMatch): string {
  return match.winner === match.a ? match.b : match.a;
}

// Rounds of one bracket played before stage `index`, to number the next one.
function sideRounds(rounds: BattleRound[], side: BracketSide, before: number): number {
  return rounds.slice(0, before).filter((r) => r.groups.some((g) => g.side === side && g.teams.length > 1)).length;
}

// The losers bracket of a stage: each survivor meets a team that just dropped
// from the winners bracket, and the teams left over play each other.
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
  // The byes go first, so they fight in the next stage.
  const through = (side: BracketSide) => {
    const bye = group(side)?.bye;
    return [...(bye ? [bye] : []), ...played(side).map((m) => m.winner as string)];
  };
  const winners = through('winners');
  const losers = through('losers'); // the teams that dropped this stage are in it already

  if (winners.length === 1 && losers.length === 1) {
    return drawStage([{ side: 'final', name: 'Grand final', teams: [winners[0], losers[0]] }], next, battle.seed);
  }
  if (losers.length === 0) return { champion: winners[0] }; // cannot happen with two teams or more
  const winnersGroup: GroupSpec = { side: 'winners', name: winnersName(winners.length, sideRounds(battle.rounds, 'winners', next) + 1), teams: winners };
  // With a winners match, teams drop into the losers bracket, so it waits for
  // them. Without one, the losers bracket plays at once, and it is the last
  // round before its final (or the final).
  const losersGroup: GroupSpec =
    winners.length > 1
      ? pendingLosers(battle.rounds, next, losers)
      : { side: 'losers', name: losersName(losers.length, sideRounds(battle.rounds, 'losers', next) + 1, true), teams: losers };
  return drawStage([winnersGroup, losersGroup], next, battle.seed);
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
    for (const m of drawLosers(battle)) Object.assign(m, { status: 'done', winner: m.a });
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
  // A team that dropped from the winners bracket is in both groups of the
  // stage once the losers bracket is drawn. The last group is where it is now.
  const group = round?.groups.filter((g) => g.teams.includes(teamId)).pop();
  if (!round || !group) return { state: 'out', opponent: null, side: null, bracket: null, losses };
  const where = { side: group.side, bracket: group.name, losses };
  if (group.pending) return { state: 'next', opponent: null, ...where };
  const match = roundMatches(battle, round.index).find((m) => m.side === group.side && (m.a === teamId || m.b === teamId));
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

// True when the upgrade or transformation can go on the weapon. The game
// decides this with the upgrade's `static weapons` (src/upgrades/Upgrade.js).
export function fitsWeapon(upgrade: Pick<Upgrade, 'weapons'>, weapon: string): boolean {
  return !upgrade.weapons || upgrade.weapons.includes(weapon);
}

// The team's upgrades and transformations without the ones that do not fit its
// weapon, then without the ones whose requirements went with them (again and
// again, in case requirements chain). `dropped` is the number of upgrade copies
// removed. Ids the catalog does not know stay; validateLoadout reports them.
export function fitLoadout(team: LoadoutTeam, catalog: Catalog): { upgrades: Record<string, number>; transformations: string[]; dropped: number } {
  const byId = new Map([...catalog.upgrades, ...catalog.transformations].map((u) => [u.id, u]));
  const fits = (id: string) => {
    const upgrade = byId.get(id);
    return !upgrade || fitsWeapon(upgrade, team.weapon);
  };
  let upgrades = Object.fromEntries(Object.entries(team.upgrades).filter(([id, n]) => n > 0 && fits(id)));
  let transformations = (team.transformations ?? []).filter(fits);
  for (;;) {
    const owned = new Set([...Object.keys(upgrades), ...transformations]);
    const met = (id: string) => (byId.get(id)?.requires ?? []).every((required) => owned.has(required));
    const keptUpgrades = Object.fromEntries(Object.entries(upgrades).filter(([id]) => met(id)));
    const keptTransformations = transformations.filter(met);
    if (Object.keys(keptUpgrades).length === Object.keys(upgrades).length && keptTransformations.length === transformations.length) break;
    upgrades = keptUpgrades;
    transformations = keptTransformations;
  }
  const copies = (list: Record<string, number>) => Object.values(list).reduce((sum, n) => sum + Math.max(0, n), 0);
  return { upgrades, transformations, dropped: copies(team.upgrades) - copies(upgrades) };
}

// Transformations the team can still take: they fit the weapon, the team does
// not have them, and it has what they require.
export function eligibleTransformations(team: LoadoutTeam, catalog: Catalog): string[] {
  const picked = team.transformations ?? [];
  const owned = new Set([...picked, ...Object.keys(team.upgrades).filter((id) => (team.upgrades[id] ?? 0) > 0)]);
  return catalog.transformations
    .filter(
      (t) =>
        fitsWeapon(t, team.weapon) &&
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
    if (!fitsWeapon(upgrade, team.weapon)) problems.push(`"${id}" does not fit ${team.weapon}`);
    if (upgrade.maxStacks !== undefined && count > upgrade.maxStacks) {
      problems.push(`"${id}" ×${count} is over its limit of ${upgrade.maxStacks}`);
    }
    const missing = (upgrade.requires ?? []).filter((required) => !owned.includes(required));
    if (missing.length > 0) problems.push(`"${id}" needs ${missing.map((required) => `"${required}"`).join(', ')}`);
  }
  return problems;
}
