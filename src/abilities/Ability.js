import { distance } from '../sim/math.js';

// Base class for a weapon's special move. Abilities fire automatically once
// they're off cooldown and shouldActivate() says it's a good moment.
//
// While active, an ability changes how its weapon and ball behave through the
// modifier getters below; the engine reads them every physics step.
//
// Lifecycle: cooldown -> shouldActivate() -> start() -> onUpdate() each step
// -> end() (call it yourself when the move is finished) -> cooldown again.
export class Ability {
  static displayName = 'Ability';

  constructor(weapon, { cooldown, initialCooldown = cooldown / 2 }) {
    this.weapon = weapon;
    this.cooldown = cooldown; // seconds
    this.cooldownLeft = initialCooldown;
    this.active = false;
  }

  get owner() {
    return this.weapon.owner;
  }

  get name() {
    return this.constructor.displayName;
  }

  // ---- Modifiers: override to change behaviour while active -------------------

  get spinMultiplier() {
    return 1;
  }

  // Flat damage added to the weapon's own, before any multiplier.
  get bonusDamage() {
    return 0;
  }

  get damageMultiplier() {
    return 1;
  }

  get knockbackMultiplier() {
    return 1;
  }

  // Multiplies damage the ball takes from weapon hits (below 1 = tougher).
  get damageTakenMultiplier() {
    return 1;
  }

  // True while the ability steers the ball itself (normal speed recovery is paused).
  get controlsMovement() {
    return false;
  }

  // True while the weapon can't be parried: it passes through other weapons.
  get unblockable() {
    return false;
  }

  // True while the ball can't be pushed by other balls: it shoves them aside instead.
  get unstoppable() {
    return false;
  }

  // True while the weapon is out of the ball's hands (thrown): no blades to hit or clash with.
  get disarmed() {
    return false;
  }

  // Only matters for multi-blade weapons: 1 = evenly spaced, 0 = gathered at the front.
  get bladeSpread() {
    return 1;
  }

  // ---- Hooks ----------------------------------------------------------------

  shouldActivate(sim) {
    return true;
  }

  onStart(sim) {}
  onUpdate(dt, sim) {} // every physics step while active
  onEnd(sim) {}
  onHit(target, sim) {} // this weapon landed a hit
  onParry(otherWeapon, sim) {} // this weapon clashed with another
  onOwnerHit(attackerWeapon, sim) {} // this ball got hit
  draw(ctx) {} // drawn underneath the balls
  drawOver(ctx) {} // drawn on top of the balls and weapons

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

  // Tell the game something visual happened. `fx` is optional presentation info:
  //   { shake: number, burst: { color?, count?, speed?, life?, size? } }
  emit(sim, phase, fx = {}) {
    sim.onEvent('ability', { ball: this.owner, ability: this, phase, ...fx });
  }

  // ---- Engine internals -------------------------------------------------------

  update(dt, sim) {
    if (this.active) {
      this.onUpdate(dt, sim);
    } else if (this.cooldownLeft > 0) {
      this.cooldownLeft -= dt;
    } else if (!sim.over && this.allowedToStart(sim) && this.shouldActivate(sim)) {
      this.start(sim);
    }
  }

  // False while an upgrade is holding this ability back (e.g. Dancer, so its
  // spin and the weapon's ability never run at the same time).
  allowedToStart(sim) {
    return this.weapon.upgrades.every((upgrade) => upgrade.allowsAbilityStart(this, sim));
  }

  start(sim) {
    this.active = true;
    this.onStart(sim);
    for (const upgrade of this.weapon.upgrades) upgrade.onAbilityStart(this, sim);
  }

  end(sim) {
    if (!this.active) return;
    this.active = false;
    this.cooldownLeft = this.cooldown;
    this.onEnd(sim);
    for (const upgrade of this.weapon.upgrades) upgrade.onAbilityEnd(this, sim);
  }
}
