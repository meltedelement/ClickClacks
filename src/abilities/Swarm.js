import { Ability } from './Ability.js';

// Drone: for a moment every drone in formation dashes at the enemy the moment
// it's back, resting skipped, and they all fly faster.
export class Swarm extends Ability {
  static displayName = 'Swarm';

  constructor(weapon) {
    super(weapon, { cooldown: 7 });

    // Stats. Upgrades may change these.
    this.duration = 1.2; // s
    this.speedBoost = 1.35; // drones fly this much faster while it lasts
    this.triggerRange = 320; // px; only starts when an enemy is within this distance

    this.timer = 0;
  }

  // The drones read this for their speed (see Drone.speedFactor).
  get spinMultiplier() {
    return this.active ? this.speedBoost : 1;
  }

  shouldActivate(sim) {
    return this.enemyWithin(sim, this.triggerRange) !== null;
  }

  onStart(sim) {
    this.timer = this.duration;
    this.emit(sim, 'swarm', { shake: 3, burst: { count: 12, speed: 220, life: 0.35 } });
  }

  onUpdate(dt, sim) {
    this.timer -= dt;
    const target = this.nearestEnemy(sim);
    if (this.timer <= 0 || !target || sim.over) {
      this.end(sim);
      return;
    }
    for (const drone of this.weapon.drones) {
      if (drone.state === 'orbit') this.weapon.launch(drone, target);
    }
  }
}
