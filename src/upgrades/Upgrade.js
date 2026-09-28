import { distance } from '../sim/math.js';

// Base class for a roguelike upgrade: a permanent change to one fighter that's
// in effect for the whole match. Upgrades are chosen outside the sim and passed
// in through the loadout (see Simulation), so a match plays out the same way
// wherever it runs.
//
// An upgrade can do any mix of:
//   - change starting stats once in apply() (blades, length, maxHp, ability numbers...)
//   - change behaviour live through the modifier getters, same as an Ability's
//   - react to things through the hooks (hits, parries, the ability starting/ending)
//   - replace the weapon's ability outright in apply()
//   - draw its own visuals (the draw* methods; the sim never calls them)
//
// Upgrades are applied in loadout order, after the weapon, its ability and its
// shield have been built, and before the ball's HP is filled to maxHp.
//
// Upgrades stack: listing an id several times gives one instance whose
// `stacks` counts the copies, and apply() runs once per copy (with `stacks`
// already counting the copy being applied). Stat changes in apply() therefore
// stack by themselves; modifier getters and hooks should scale with `stacks`.
export class Upgrade {
  static id = 'upgrade'; // unique key used by the registry and loadouts
  static displayName = 'Upgrade';
  static description = '';
  // Weapon ids this upgrade can go on, or null for any weapon.
  static weapons = null;
  // Upgrade ids that must also be in the loadout for this one to be taken.
  static requires = [];
  // Most copies of this upgrade one fighter can have.
  static maxStacks = Infinity;

  static canApplyTo(weaponId) {
    return this.weapons === null || this.weapons.includes(weaponId);
  }

  constructor(weapon) {
    this.weapon = weapon;
    this.stacks = 0; // copies taken; counted up by Ball before each apply()
  }

  get owner() {
    return this.weapon.owner;
  }

  get ability() {
    return this.weapon.ability;
  }

  get name() {
    return this.constructor.displayName;
  }

  // Runs once per copy at spawn. Change base stats here. To stack linearly,
  // remember the starting value on the first copy (`this.base ??= ...`) and add
  // a share of it each time. The ability's first cooldown was already worked
  // out from its original `cooldown`, so if you change `cooldown` set
  // `cooldownLeft` too.
  apply() {}

  // ---- Modifiers: combined with the ability's and every other upgrade's ------
  // Multipliers are multiplied together; flags are on if anything turns them on.

  get spinMultiplier() {
    return 1;
  }

  get damageMultiplier() {
    return 1;
  }

  get knockbackMultiplier() {
    return 1;
  }

  get damageTakenMultiplier() {
    return 1;
  }

  get controlsMovement() {
    return false;
  }

  get unblockable() {
    return false;
  }

  get unstoppable() {
    return false;
  }

  get bladeSpread() {
    return 1;
  }

  // ---- Hooks ----------------------------------------------------------------
  // Upgrade hooks run after the ability's and the weapon's own, so they see
  // the state after this hit's scaling has been applied.

  onUpdate(dt, sim) {} // every physics step
  onHit(target, sim, damage) {} // this weapon landed a hit
  onParry(otherWeapon, sim) {} // this weapon clashed with another
  onOwnerHit(attackerWeapon, sim, damage) {} // this ball got hit
  onBlock(attackerWeapon, sim) {} // this weapon's shield stopped an enemy weapon
  onWallBounce(sim) {} // this ball bounced off a wall
  onAbilityStart(ability, sim) {}
  onAbilityEnd(ability, sim) {}

  // ---- Visuals (browser only, never called by the sim) ------------------------

  drawUnder(ctx) {} // underneath the balls, like ability effects
  drawBlade(ctx, start) {} // on top of each blade, in the same local space as Weapon.drawLocal
  drawOver(ctx) {} // on top of the balls and weapons

  // ---- Helpers --------------------------------------------------------------

  nearestEnemy(sim) {
    let nearest = null;
    let best = Infinity;
    for (const ball of sim.aliveBalls) {
      if (ball === this.owner) continue;
      const d = distance(ball.pos, this.owner.pos);
      if (d < best) {
        best = d;
        nearest = ball;
      }
    }
    return nearest;
  }

  // Tell the game something visual happened; sent as an 'upgrade' event.
  //   fx: { shake?: number, burst?: { color?, count?, speed?, life?, size? },
  //         text?: string, color?: string }  (text floats up above the ball)
  emit(sim, phase, fx = {}) {
    sim.onEvent('upgrade', { ball: this.owner, upgrade: this, phase, ...fx });
  }
}
