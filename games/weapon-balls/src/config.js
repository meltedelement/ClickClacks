// Global tuning knobs. Weapon-specific numbers live in each weapon's own file.
export const CONFIG = {
  arena: { width: 450, height: 450 },

  // Physics runs at a fixed rate regardless of frame rate, so fights play out
  // the same on any machine and fast-spinning weapons don't skip through balls.
  physicsHz: 120,

  ball: {
    radius: 40,
    speed: 300, // px/s each ball tries to travel at
    speedRecovery: 2.5, // how quickly a ball returns to `speed` after knockback (per second)
    maxHp: 100,
    spawnDistance: 130, // px from arena centre
  },

  combat: {
    hitCooldown: 0.3, // s before the same weapon can hit the same ball again
    parryCooldown: 0.15, // s before a weapon can parry again
    knockback: 1.5, // target is launched at speed * knockback when hit
    parryKnockback: 1.3,
  },

  // A match still going `after` sim seconds in goes to sudden death: every
  // `interval` seconds each ball loses `damage` HP, plus `ramp` more per tick,
  // until one drops. Armor, dodge and upgrades don't apply. A match can set its
  // own `after`, or turn it off with null (see Simulation).
  suddenDeath: { after: 120, interval: 1, damage: 2, ramp: 1 },

  // Royale: a crowd of balls in one big arena. A kill hands the victim's mass
  // to the killer, and a ball's size (radius, blade length, shields) is
  // mass ** sizeExponent, so kills make it bigger. Max HP and damage dealt are
  // multiplied by size ** hpScaling and size ** damageScaling (0 = don't
  // scale). See Simulation's `royale` option and Ball.grow.
  royale: {
    spacing: 190, // arena units of side per sqrt(ball): the arena is spacing * sqrt(count) square
    sizeExponent: 1 / 3, // size from mass; 1/2 would keep area equal to mass, but the last two would fill the arena
    hpScaling: 1,
    damageScaling: 0.5,
    // Sudden death starts at base + perBall * count sim seconds.
    suddenDeath: { base: 60, perBall: 1.2 },
  },

  // Brief freeze on impact to make hits feel heavy. Purely visual, lives in the game loop.
  hitstop: { base: 0.035, perDamage: 0.008, max: 0.18, parry: 0.03, crit: 0.12 },
};
