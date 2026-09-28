// Pure battle logic: who fights whom, who is winning, and whether a loadout is
// one the game will accept. Shared by the quiz server (which queues the
// matches) and the React pages (which show the standings), so it must not
// import anything from either side.
import type { BattleMatch, Catalog } from './types.ts';

// A team as this file needs it.
export interface LoadoutTeam {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
}

export interface Pairing {
  a: string;
  b: string;
  seed: number;
}

// Every team plays every other team once. Pairings come from the circle
// method, so no team plays twice in the same round and an odd team count gives
// one rotating bye per round instead of a match. Returns [] for fewer than two
// teams.
export function buildSchedule(teamIds: string[], seedOf: () => number): Pairing[] {
  if (teamIds.length < 2) return [];
  const ids = [...teamIds];
  const bye = '';
  if (ids.length % 2 === 1) ids.push(bye); // the bye sits in the rotation
  const half = ids.length / 2;
  const pairings: Pairing[] = [];
  for (let round = 0; round < ids.length - 1; round++) {
    for (let i = 0; i < half; i++) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a !== bye && b !== bye) pairings.push({ a, b, seed: seedOf() });
    }
    // Keep the first team fixed and rotate the rest.
    ids.splice(1, 0, ids.pop() as string);
  }
  return pairings;
}

export interface Standing {
  teamId: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number; // win 1, draw 0.5, loss 0
  hpFor: number;
  hpAgainst: number;
}

// The table, best first: most points, then the best HP difference, then name.
// Only 'done' matches count; a cancelled or failed one never happened.
export function standings(teams: { id: string; name: string }[], matches: BattleMatch[]): Standing[] {
  const rows = new Map<string, Standing>();
  for (const team of teams) {
    rows.set(team.id, { teamId: team.id, name: team.name, played: 0, wins: 0, draws: 0, losses: 0, points: 0, hpFor: 0, hpAgainst: 0 });
  }
  for (const match of matches) {
    if (match.status !== 'done') continue;
    const a = rows.get(match.a);
    const b = rows.get(match.b);
    if (!a || !b) continue; // a team was deleted after the battle started
    const hp = match.hp ?? [0, 0];
    a.played++;
    b.played++;
    a.hpFor += hp[0];
    a.hpAgainst += hp[1];
    b.hpFor += hp[1];
    b.hpAgainst += hp[0];
    if (match.winner === match.a) {
      a.wins++;
      b.losses++;
      a.points += 1;
    } else if (match.winner === match.b) {
      b.wins++;
      a.losses++;
      b.points += 1;
    } else {
      a.draws++;
      b.draws++;
      a.points += 0.5;
      b.points += 0.5;
    }
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.hpFor - y.hpAgainst - (x.hpFor - x.hpAgainst) ||
      x.name.localeCompare(y.name),
  );
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
