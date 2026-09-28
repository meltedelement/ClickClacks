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

  // Brief freeze on impact to make hits feel heavy. Purely visual, lives in the game loop.
  hitstop: { base: 0.035, perDamage: 0.008, max: 0.18, parry: 0.03 },
};
