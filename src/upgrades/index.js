import {
  Armor,
  Compact,
  Critical,
  ExtraBlade,
  Focus,
  HeavyBlade,
  Lifesteal,
  LongBlade,
  QuickSpin,
  Sharpened,
  Swift,
  Thorns,
  Vitality,
} from './common.js';
import { BigShield, LongSwipe, ShieldBash, SpikedShield, WideSwipe } from './sword.js';
import { DashGuard, DeadlyCrits, LongDash, QuickCharge, RapidGrowth } from './spear.js';
import { CloseQuarters, Evasion, Momentum, QuickRecovery, Rebound } from './daggers.js';
import { GreatMace, HeavyImpact, HighBounce, Meteor, QuickDrop } from './mace.js';

// Every upgrade that can go into a loadout, in the order the menu lists them.
// Add new ones here (after writing them in common.js for any weapon, or in the
// weapon's own file) and they can be used by id in loadouts, the menu and the
// balance script.
export const UPGRADES = [
  // Any weapon
  Sharpened,
  QuickSpin,
  LongBlade,
  HeavyBlade,
  Compact,
  Thorns,
  Vitality,
  Swift,
  Focus,
  Armor,
  Lifesteal,
  Critical,
  ExtraBlade,
  // Sword
  ShieldBash,
  WideSwipe,
  SpikedShield,
  LongSwipe,
  BigShield,
  // Spear
  LongDash,
  QuickCharge,
  DashGuard,
  RapidGrowth,
  DeadlyCrits,
  // Daggers
  QuickRecovery,
  Momentum,
  CloseQuarters,
  Evasion,
  Rebound,
  // Mace
  QuickDrop,
  HeavyImpact,
  HighBounce,
  GreatMace,
  Meteor,
];

export function getUpgradeById(id) {
  const upgrade = UPGRADES.find((U) => U.id === id);
  if (!upgrade) throw new Error(`Unknown upgrade: ${id}`);
  return upgrade;
}

// Upgrades that could be added to a fighter with this weapon that already has
// the `owned` upgrade ids (repeats allowed): ones that fit the weapon, aren't
// at their stack limit, and whose requirements are met. E.g. for offering
// choices in a run.
export function upgradesFor(weaponId, owned = []) {
  return UPGRADES.filter(
    (U) =>
      U.canApplyTo(weaponId) &&
      countOf(owned, U.id) < U.maxStacks &&
      U.requires.every((id) => owned.includes(id)),
  );
}

// Turns a loadout's upgrade ids into classes, checking each one exists, fits
// the weapon, isn't over its stack limit, and has what it requires. An id
// listed several times stacks.
export function resolveUpgrades(ids, weaponId) {
  return ids.map((id) => {
    const Upgrade = getUpgradeById(id);
    if (!Upgrade.canApplyTo(weaponId)) throw new Error(`Upgrade "${id}" can't go on weapon "${weaponId}"`);
    if (countOf(ids, id) > Upgrade.maxStacks) throw new Error(`Upgrade "${id}" stacks at most ${Upgrade.maxStacks} times`);
    const missing = Upgrade.requires.filter((req) => !ids.includes(req));
    if (missing.length > 0) throw new Error(`Upgrade "${id}" needs ${missing.map((req) => `"${req}"`).join(', ')}`);
    return Upgrade;
  });
}

function countOf(ids, id) {
  return ids.filter((x) => x === id).length;
}
