import { CONFIG } from '../config.js';
import { Ball } from './Ball.js';
import { TAU, add, fromAngle, normalize, scale, sub } from './math.js';
import { bounceOffWalls, resolveBallCollision, weaponHitsBall, weaponHitsShield, weaponsClash } from './collisions.js';

// Pure match logic: no DOM, no rendering. The browser game and the headless
// balance script both drive this by calling step(dt).
//
// Things that happen are reported through onEvent(type, data):
//   'hit'   { attacker, target, damage, point }
//   'parry' { a, b, point }
//   'block' { attacker, defender, point }  (a weapon hit a shield)
//   'death' { ball }
//   'end'   { winner }  (winner is null on a draw)
//   'ability' { ball, ability, phase, shake?, burst? }  (see Ability.emit)
export class Simulation {
  constructor(weaponClasses, { onEvent } = {}) {
    this.arena = { ...CONFIG.arena };
    this.onEvent = onEvent ?? (() => {});
    this.time = 0;
    this.over = false;
    this.winner = null;
    this.balls = this.spawnBalls(weaponClasses);
  }

  // Balls start evenly spaced around the centre; for two that's left vs right.
  spawnBalls(weaponClasses) {
    const center = { x: this.arena.width / 2, y: this.arena.height / 2 };
    const copies = new Map();

    return weaponClasses.map((WeaponClass, i) => {
      const angle = Math.PI + (i * TAU) / weaponClasses.length;
      // Mirror matches get a darker shade so you can tell them apart.
      const copy = copies.get(WeaponClass) ?? 0;
      copies.set(WeaponClass, copy + 1);

      return new Ball({
        position: add(center, fromAngle(angle, CONFIG.ball.spawnDistance)),
        color: `hsl(${WeaponClass.hue}, 70%, ${55 - copy * 18}%)`,
        WeaponClass,
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
    for (const ball of balls) bounceOffWalls(ball, this.arena);
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
      if (a.weapon.parryCooldown <= 0 && b.weapon.parryCooldown <= 0) {
        this.applyParry(a, b, point);
      }
    });

    // Enemy weapons touching a shield are blocked too.
    for (const defender of balls) {
      const { shield } = defender.weapon;
      if (!shield) continue;
      for (const attacker of balls) {
        if (attacker === defender || attacker.weapon.unblockable) continue;
        const point = weaponHitsShield(attacker.weapon, shield);
        if (!point) continue;
        blocked.add(attacker.weapon);
        if (attacker.weapon.parryCooldown <= 0) this.applyBlock(attacker, defender, point);
      }
    }

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
  }

  applyHit(attacker, target, point) {
    const weapon = attacker.weapon;
    const damage = weapon.getDamage();
    target.takeHit(weapon, damage);

    // Launch the target directly away from where it was struck.
    const away = sub(target.pos, point);
    const n = normalize(away.x || away.y ? away : sub(target.pos, attacker.pos));
    target.vel = scale(n, target.speed * CONFIG.combat.knockback * weapon.knockbackMultiplier);

    target.weapon.registerOwnerHit(weapon, this);
    weapon.registerHit(target, this);
    this.onEvent('hit', { attacker, target, damage, point });
    if (!target.alive) this.onEvent('death', { ball: target });
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
