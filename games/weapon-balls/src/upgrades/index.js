import { WEAPONS } from '../weapons/index.js';
import {
  Armor,
  Compact,
  Critical,
  Focus,
  HeavyBlade,
  Lifesteal,
  LongBlade,
  QuickSpin,
  Sabotage,
  Sharpened,
  Thorns,
  Vitality,
} from './common.js';
import { BigShield, LongSwipe, ShieldBash, SpikedShield, WideSwipe } from './sword.js';
import { Captain, Dizzy, DualWielder, FireEater, Gladiator, Piercer, Stalwart, Wildling } from './sword-transformations.js';
import { DashGuard, PatientCharge, RapidGrowth } from './spear.js';
import { Bouncer, Dancer, Hoplite, Olympian, Poseidon, Runner, Tackler, Tactician } from './spear-transformations.js';
import { CloseQuarters, Evasion, Momentum } from './daggers.js';
import { Ambidextrous, Careful, Rogue, Saw, Slippery, Swashbuckler, Thief, Trickster } from './daggers-transformations.js';
import { GreatMace, HeavyImpact, HighBounce, Meteor, SlowDrop } from './mace.js';
import { Crusher, Devil, Kamikaze, Metalworker, Pilot, Portaler, RubberMace, Valkyrie } from './mace-transformations.js';
import { Boosters, DefenseMatrix, QuickProduction, QuickRepair, SpikedDrones } from './drone.js';
import { Ace, Daredevils, Fighters, Fortress, Legion, NonEuclidean, Slicers, Wingmen } from './drone-transformations.js';
import { Accurate, AntiMateriel, FireRate, MotivatedBullets, PopPop } from './gun.js';
import { Bayonet, Grenadier, HighEx, Hotshot, Shotgun, SixShooter, Smg } from './gun-transformations.js';
import { BigRing, Echo, Magnetism, PanicButton, ThickOrbs } from './wand.js';
import { Aeromancer, Artificer, Evoker, Geomancer, Hydromancer, Merlin, Pyromancer, WildMagic } from './wand-transformations.js';
import { MorePortals, QuickLashes, StickyTentacles, StretchyTentacles, ThickTentacles } from './tome.js';
import { AbyssWarlock, Arsonist, BestialWorshipper, Ensnarer, Priest, Puppeteer, Satanist, Witch } from './tome-transformations.js';

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
  Sabotage,
  Focus,
  Armor,
  Lifesteal,
  Critical,
  // Sword
  ShieldBash,
  WideSwipe,
  SpikedShield,
  LongSwipe,
  BigShield,
  // Sword transformations
  Stalwart,
  Wildling,
  Dizzy,
  Captain,
  FireEater,
  Piercer,
  DualWielder,
  Gladiator,
  // Spear
  PatientCharge,
  DashGuard,
  RapidGrowth,
  // Spear transformations
  Hoplite,
  Poseidon,
  Dancer,
  Bouncer,
  Olympian,
  Tactician,
  Tackler,
  Runner,
  // Daggers
  Momentum,
  CloseQuarters,
  Evasion,
  // Daggers transformations
  Rogue,
  Thief,
  Saw,
  Trickster,
  Ambidextrous,
  Slippery,
  Careful,
  Swashbuckler,
  // Mace
  SlowDrop,
  HeavyImpact,
  HighBounce,
  GreatMace,
  Meteor,
  // Mace transformations
  Portaler,
  Valkyrie,
  Metalworker,
  Pilot,
  Crusher,
  RubberMace,
  Kamikaze,
  Devil,
  // Drone
  QuickRepair,
  QuickProduction,
  DefenseMatrix,
  Boosters,
  SpikedDrones,
  // Drone transformations
  NonEuclidean,
  Ace,
  Legion,
  Fighters,
  Daredevils,
  Slicers,
  Fortress,
  Wingmen,
  // Gun
  FireRate,
  Accurate,
  MotivatedBullets,
  AntiMateriel,
  PopPop,
  // Gun transformations
  SixShooter,
  Shotgun,
  Smg,
  HighEx,
  Grenadier,
  Bayonet,
  Hotshot,
  // Wand
  ThickOrbs,
  Echo,
  Magnetism,
  PanicButton,
  BigRing,
  // Wand transformations
  Merlin,
  Evoker,
  Pyromancer,
  Aeromancer,
  Hydromancer,
  Geomancer,
  WildMagic,
  Artificer,
  // Tome
  MorePortals,
  ThickTentacles,
  StickyTentacles,
  StretchyTentacles,
  QuickLashes,
  // Tome transformations
  AbyssWarlock,
  Puppeteer,
  Ensnarer,
  Satanist,
  Priest,
  BestialWorshipper,
  Arsonist,
  Witch,
];

// The weapon ids `Upgrade` can go on, or null for any weapon: what a catalog
// lists as its `weapons` (a `notWeapons` list becomes the weapons it leaves).
export function weaponsFor(Upgrade) {
  if (Upgrade.weapons) return Upgrade.weapons.filter((id) => !Upgrade.notWeapons.includes(id));
  if (Upgrade.notWeapons.length === 0) return null;
  return WEAPONS.map((W) => W.id).filter((id) => Upgrade.canApplyTo(id));
}

// Most copies a catalog describes: more than any draft is likely to stack.
const DESCRIBED_STACKS = 30;

// What a catalog lists as an upgrade's `stacked`: entry i says what i + 2
// copies do together, up to its stack limit. Empty when it can't stack.
export function stackedDescriptions(Upgrade) {
  const most = Math.min(Upgrade.maxStacks, DESCRIBED_STACKS);
  const list = [];
  for (let n = 2; n <= most; n++) list.push(Upgrade.describe(n));
  return list;
}

export function getUpgradeById(id) {
  const upgrade = UPGRADES.find((U) => U.id === id);
  if (!upgrade) throw new Error(`Unknown upgrade: ${id}`);
  return upgrade;
}

// Upgrades that could be added to a fighter with this weapon that already has
// the `owned` upgrade ids (repeats allowed): ones that fit the weapon, aren't
// at their stack limit, whose requirements are met, and that nothing owned
// makes useless. E.g. for offering choices in a run.
export function upgradesFor(weaponId, owned = []) {
  return UPGRADES.filter(
    (U) =>
      U.canApplyTo(weaponId) &&
      countOf(owned, U.id) < U.maxStacks &&
      U.requires.every((id) => owned.includes(id)) &&
      !U.excludedBy.some((id) => owned.includes(id)),
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
