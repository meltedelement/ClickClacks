// The quiz's loadout rules: which upgrades and transformations fit a team's
// weapon, and what is left when the weapon changes. Shared by the quiz server
// (offers, host edits) and the admin page, so it must not import anything from
// either side. Whether the game accepts a loadout is the game's call: the
// tournament service asks it and reports each team's problems.
import type { Catalog, Upgrade } from './types.ts';

// A team as this file needs it.
export interface LoadoutTeam {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
  transformations?: string[];
}

// True when the upgrade or transformation can go on the weapon. The game
// decides this with the upgrade's `static weapons` (src/upgrades/Upgrade.js).
export function fitsWeapon(upgrade: Pick<Upgrade, 'weapons'>, weapon: string): boolean {
  return !upgrade.weapons || upgrade.weapons.includes(weapon);
}

// The team's upgrades and transformations without the ones that do not fit its
// weapon, then without the ones whose requirements went with them (again and
// again, in case requirements chain). `dropped` is the number of upgrade copies
// removed. Ids the catalog does not know stay; the game reports them.
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
