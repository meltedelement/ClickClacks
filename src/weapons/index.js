import { Sword } from './Sword.js';
import { Spear } from './Spear.js';
import { Mace } from './Mace.js';
import { Daggers } from './Daggers.js';
import { Drone } from './Drone.js';

// Every selectable weapon. Add new ones here and they show up in the UI
// and the balance script automatically.
export const WEAPONS = [Sword, Spear, Mace, Daggers, Drone];

export function getWeaponById(id) {
  const weapon = WEAPONS.find((W) => W.id === id);
  if (!weapon) throw new Error(`Unknown weapon: ${id}`);
  return weapon;
}
