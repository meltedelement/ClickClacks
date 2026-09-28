import { CONFIG } from '../config.js';
import { Ball } from './Ball.js';
import { TAU, add, fromAngle, normalize, scale, sub } from './math.js';
import { bounceOffWalls, resolveBallCollision, shieldHitsBall, weaponHitsBall, weaponHitsShield, weaponsClash } from './collisions.js';
import { getWeaponById } from '../weapons/index.js';
import { resolveUpgrades } from '../upgrades/index.js';

// Pure match logic: no DOM, no rendering. The browser game and the headless
// balance script both drive this by calling step(dt).
//
// A match is set up from one loadout per fighter. Loadouts are plain data, so
// they can be saved with a run or sent to a worker thread:
//   { weapon: 'sword', upgrades: ['extra-blade', 'lifesteal'], name: 'Team Alpha' }
// `name` is optional and only for display; without it a fighter is called by its weapon.
// Upgrade ids must exist, fit the weapon, and not repeat (see src/upgrades/).
//
// Things that happen are reported through onEvent(type, data):
//   'hit'   { attacker, target, damage, dealt, crit, point }  (dealt = HP actually removed)
//   'dodge' { attacker, target, point }  (a weapon hit that the target dodged)
//   'damage' { source, target, damage, dealt, reason, color? }  (damage not from a weapon hit, see dealDamage)
//   'parry' { a, b, point }
//   'block' { attacker, defender, point }  (a weapon hit a shield)
//   'death' { ball }
//   'end'   { winner }  (winner is null on a draw)
//   'ability' { ball, ability, phase, shake?, burst? }  (see Ability.emit)
//   'upgrade' { ball, upgrade, phase, shake?, burst?, text?, color?, pos? }  (see Upgrade.emit)
export class Simulation {
  constructor(loadouts, { onEvent } = {}) {
    this.arena = { ...CONFIG.arena };
    this.onEvent = onEvent ?? (() => {});
    this.time = 0;
    this.over = false;
    this.winner = null;
    this.balls = this.spawnBalls(loadouts);
  }

  // Balls start evenly spaced around the centre; for two that's left vs right.
  spawnBalls(loadouts) {
    const center = { x: this.arena.width / 2, y: this.arena.height / 2 };
    const copies = new Map();

    return loadouts.map((loadout, i) => {
      const WeaponClass = getWeaponById(loadout.weapon);
      const upgrades = resolveUpgrades(loadout.upgrades ?? [], WeaponClass.id);
      const angle = Math.PI + (i * TAU) / loadouts.length;
      // Mirror matches get a darker shade so you can tell them apart.
      const copy = copies.get(WeaponClass) ?? 0;
      copies.set(WeaponClass, copy + 1);

      return new Ball({
        position: add(center, fromAngle(angle, CONFIG.ball.spawnDistance)),
        color: `hsl(${WeaponClass.hue}, 70%, ${55 - copy * 18}%)`,
        WeaponClass,
        upgrades,
        name: loadout.name,
      });
    });
  }

  get aliveBalls() {
    return this.balls.filter((b) => b.alive);
  }

  step(dt) {
    this.time += dt;
    const balls = this.aliveBalls;

    for (const ball of balls) ball.update(dt, this);
    for (const ball of balls) {
      if (bounceOffWalls(ball, this.arena)) ball.weapon.registerWallBounce(this);
    }
    forEachPair(balls, resolveBallCollision);

    // Once the match is decided the winner keeps bouncing around, but nothing fights.
    if (!this.over) this.resolveCombat(balls);
  }

  resolveCombat(balls) {
    // Weapons that are touching another weapon are blocked this step and can't hit.
    const blocked = new Set();

    forEachPair(balls, (a, b) => {
      if (a.weapon.unblockable || b.weapon.unblockable) return;
      const point = weaponsClash(a.weapon, b.weapon);
      if (!point) return;
      blocked.add(a.weapon);
      blocked.add(b.weapon);
      if (a.weapon.canParry(b.weapon) && b.weapon.canParry(a.weapon)) {
        this.applyParry(a, b, point);
      }
    });

    // Enemy weapons touching a shield are blocked too.
    for (const defender of balls) {
      for (const shield of defender.weapon.heldShields) {
        for (const attacker of balls) {
          if (attacker === defender || attacker.weapon.unblockable) continue;
          const point = weaponHitsShield(attacker.weapon, shield);
          if (!point) continue;
          blocked.add(attacker.weapon);
          if (attacker.weapon.canParry(defender.weapon)) this.applyBlock(attacker, defender, point);
        }
      }
    }

    // Spiked shields (and off-hand swords) hurt enemy balls they touch.
    for (const defender of balls) {
      for (const shield of defender.weapon.heldShields) {
        if (!shield.contactDamage) continue;
        for (const target of balls) {
          if (target === defender || !defender.alive || !target.alive || !target.canBeHitBy(shield)) continue;
          if (!shieldHitsBall(shield, target)) continue;
          target.hitCooldowns.set(shield, CONFIG.combat.hitCooldown);
          this.dealDamage(defender, target, shield.contactDamage, { reason: shield.contactReason, color: shield.contactColor });
        }
      }
    }

    // A ball killed earlier in this step still swings: simultaneous hits trade, whatever the slot order.
    for (const attacker of balls) {
      if (blocked.has(attacker.weapon)) continue;
      for (const target of balls) {
        if (target === attacker || !target.alive || !target.canBeHitBy(attacker.weapon)) continue;
        const point = weaponHitsBall(attacker.weapon, target);
        if (point) this.applyHit(attacker, target, point);
      }
    }

    this.checkForWinner();
  }

  applyParry(a, b, point) {
    for (const weapon of [a.weapon, b.weapon]) {
      weapon.spinDir *= -1;
      weapon.parryCooldown = CONFIG.combat.parryCooldown;
    }

    const n = normalize(sub(b.pos, a.pos));
    a.vel = scale(n, -a.speed * CONFIG.combat.parryKnockback);
    b.vel = scale(n, b.speed * CONFIG.combat.parryKnockback);

    a.weapon.registerParry(b.weapon, this);
    b.weapon.registerParry(a.weapon, this);
    this.onEvent('parry', { a, b, point });
  }

  // Like a parry, but only the attacker bounces off: the shield holds firm.
  applyBlock(attacker, defender, point) {
    attacker.weapon.spinDir *= -1;
    attacker.weapon.parryCooldown = CONFIG.combat.parryCooldown;
    const n = normalize(sub(attacker.pos, defender.pos));
    attacker.vel = scale(n, attacker.speed * CONFIG.combat.parryKnockback);
    attacker.weapon.registerParry(defender.weapon, this);
    this.onEvent('block', { attacker, defender, point });
    defender.weapon.registerBlock(attacker.weapon, this);
  }

  applyHit(attacker, target, point) {
    const weapon = attacker.weapon;

    // A dodge wastes the swing: no damage, no knockback, and the usual hit
    // cooldown so it isn't rerolled every step while the blade passes through.
    if (target.dodges()) {
      target.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
      this.onEvent('dodge', { attacker, target, point });
      return;
    }

    // An upgrade on the target can cancel the hit outright (it shows that itself).
    if (target.weapon.preventsHit(weapon, this)) {
      target.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
      return;
    }

    const crit = weapon.rollCrit();
    const damage = target.reduceDamage(weapon.getDamage() * (crit ? weapon.critMultiplier : 1));
    const dealt = target.takeHit(weapon, damage);

    // Launch the target directly away from where it was struck.
    const away = sub(target.pos, point);
    const n = normalize(away.x || away.y ? away : sub(target.pos, attacker.pos));
    target.vel = scale(n, target.speed * CONFIG.combat.knockback * weapon.knockbackMultiplier);

    this.onEvent('hit', { attacker, target, damage, dealt, crit, point });
    if (!target.alive) this.onEvent('death', { ball: target });
    target.weapon.registerOwnerHit(weapon, this, damage);
    weapon.registerHit(target, this, damage);
  }

  // Damage that doesn't come from a weapon hit (thorns, spiked shields, burning...):
  // no knockback, no hit cooldown, and armor and dodging don't apply. Hooks
  // aren't triggered either, so thorns can't bounce off thorns forever.
  dealDamage(source, target, damage, { reason, color } = {}) {
    if (!target.alive || damage <= 0) return;
    const dealt = target.takeDamage(damage);
    this.onEvent('damage', { source, target, damage, dealt, reason, color });
    if (!target.alive) this.onEvent('death', { ball: target });
  }

  // Ends the match with no winner, e.g. when it runs past a time limit.
  endInDraw() {
    if (this.over) return;
    this.over = true;
    this.winner = null;
    this.onEvent('end', { winner: null });
  }

  checkForWinner() {
    const alive = this.aliveBalls;
    if (alive.length > 1) return;
    this.over = true;
    this.winner = alive[0] ?? null;
    this.onEvent('end', { winner: this.winner });
  }
}

function forEachPair(items, fn) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) fn(items[i], items[j]);
  }
}
