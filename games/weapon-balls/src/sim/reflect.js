import { closestPointOnSegment, distance } from './math.js';

// Projectiles of every kind (bullets, grenades, thrown shields and spears,
// boomerangs, nets...) ask this each step: is a ball that is reflecting
// projectiles (a parrying Daggers, see Weapon.projectileReflectRadius) in the
// way? `from` to `to` is the path the projectile took this step (leave `to` out
// for a point). Returns the reflecting ball, whose ability has been told, or
// null. The projectile then turns on its sender and deals its damage as the
// reflector, scaled by reflectDamage.
export function reflectedBy(sim, owner, from, to = from) {
  for (const enemy of sim.aliveBalls) {
    if (enemy === owner) continue;
    const zone = enemy.weapon.projectileReflectRadius;
    if (zone <= 0) continue;
    const near = closestPointOnSegment(enemy.pos, from, to);
    if (distance(near, enemy.pos) >= enemy.radius + zone) continue;
    enemy.weapon.ability?.onProjectileReflected?.(near, sim);
    return enemy;
  }
  return null;
}

// What a reflected projectile deals back: its damage, scaled by the reflector's counter.
export function reflectDamage(reflector, damage) {
  return damage * (reflector.weapon.ability?.counterMultiplier ?? 1);
}
