import { CONFIG } from '../config.js';
import { Ball } from './Ball.js';
import { TAU, add, fromAngle, normalize, scale, sub } from './math.js';
import { allNear, sweepNear } from './broadphase.js';
import { bounceOffWalls, resolveBallCollision, shieldHitsBall, weaponHitsBall, weaponHitsShield, weaponsClash } from './collisions.js';
import { getWeaponById } from '../weapons/index.js';
import { resolveUpgrades } from '../upgrades/index.js';

// Pure match logic: no DOM, no rendering. The browser game and the headless
// balance script both drive this by calling step(dt).
//
// A match is set up from one loadout per fighter. Loadouts are plain data, so
// they can be saved with a run or sent to a worker thread:
//   { weapon: 'sword', upgrades: ['crit', 'lifesteal'], name: 'Team Alpha', color: '#e5484d' }
// `name`, `color`, `highlight`, `skin` and `tag` are optional and only for display; without them
// a fighter is called by its weapon, its ball takes the weapon's colour, and it
// has no ring around it. `size` (royale only, default 1) is its starting size:
// unlike those it changes the fight, since radius, blades, HP and damage go with it.
// Upgrade ids must exist, fit the weapon, and not repeat (see src/upgrades/).
//
// Things that happen are reported through onEvent(type, data):
//   'hit'   { attacker, target, damage, dealt, crit, point }  (dealt = HP actually removed)
//   'dodge' { attacker, target, point, quiet? }  (a weapon hit that the target dodged)
//   'damage' { source, target, damage, dealt, reason, color?, crit?, quiet? }  (damage not from a blade: dealDamage,
//            or a shield-side hit, see applySecondaryHit; source is null for sudden death)
//   'parry' { a, b, point }
//   'block' { attacker, defender, point }  (a weapon hit a shield)
//   'death' { ball }
//   'end'   { winner, decidedBy }  (winner is null on a draw; decidedBy is 'ko', 'hp' or null)
//   'ability' { ball, ability, phase, shake?, burst? }  (see Ability.emit; `ability` is null for a
//            weapon's own, like the Gun's 'gunshot', 'eject' and 'reload', or the Wand's 'pop' and 'fizzle')
//   'upgrade' { ball, upgrade, phase, shake?, burst?, text?, color?, pos? }  (see Upgrade.emit)
//   'grow'  { ball, victim, factor }  (royale: `ball` knocked `victim` out and grew by `factor`)
export class Simulation {
  // `tiebreak: 'hp'` means a match never ends in a draw: see endOnTime and checkForWinner.
  // `suddenDeath` is the sim time sudden death starts at, or null for none (see applySuddenDeath);
  // left out, it's CONFIG.suddenDeath.after (or later in a royale, CONFIG.royale.suddenDeath).
  // `royale: true` is a battle royale: the arena grows to fit the crowd (CONFIG.royale),
  // balls start spread over it, and a kill grows the killer (see knockOut).
  constructor(loadouts, { onEvent, tiebreak = null, suddenDeath, royale = false } = {}) {
    this.royale = royale;
    this.arena = royale ? royaleArena(loadouts.length) : { ...CONFIG.arena };
    this.onEvent = onEvent ?? (() => {});
    this.tiebreak = tiebreak;
    this.suddenDeathAt = suddenDeath !== undefined ? suddenDeath : royale ? royaleSuddenDeath(loadouts.length) : CONFIG.suddenDeath.after;
    this.suddenDeathTicks = 0;
    this.combatRound = 0; // see resolveCombat
    this.time = 0;
    this.over = false;
    this.winner = null;
    this.decidedBy = null; // 'ko' or 'hp' once there is a winner
    this.balls = this.spawnBalls(loadouts);
    this.alive = this.balls; // see aliveBalls
    // Balls with an upgrade that hears about other balls' wall bounces
    // (onOtherWallBounce: Puppeteer). Usually none, so a bounce costs nothing more.
    this.wallWatchers = this.balls.filter((ball) => ball.weapon.upgradesWith('onOtherWallBounce').length > 0);
  }

  // Balls start evenly spaced around the centre; for two that's left vs right.
  // The ring only widens once there are too many balls to fit on it without
  // touching (about ten), and never past the walls, so smaller matches start
  // exactly where they always did. A royale spreads them over a grid instead.
  spawnBalls(loadouts) {
    const center = { x: this.arena.width / 2, y: this.arena.height / 2 };
    const copies = new Map();
    const { radius, spawnDistance } = CONFIG.ball;
    const fit = (loadouts.length * radius * 2.2) / TAU;
    const maxDistance = Math.min(this.arena.width, this.arena.height) / 2 - radius * 1.1;
    const distance = Math.max(spawnDistance, Math.min(fit, maxDistance));
    const cells = this.royale ? royaleGrid(loadouts.length, this.arena) : null;

    return loadouts.map((loadout, i) => {
      const WeaponClass = getWeaponById(loadout.weapon);
      const upgrades = resolveUpgrades(loadout.upgrades ?? [], WeaponClass.id);
      const angle = Math.PI + (i * TAU) / loadouts.length;
      // Mirror matches get a darker shade so you can tell them apart. A royale
      // has dozens of each weapon, so its shades cycle through a range instead.
      const copy = copies.get(WeaponClass) ?? 0;
      copies.set(WeaponClass, copy + 1);
      const lightness = this.royale ? 40 + ((copy * 7) % 28) : 55 - copy * 18;

      return new Ball({
        position: cells ? cells(i) : add(center, fromAngle(angle, distance)),
        color: loadout.color ?? `hsl(${WeaponClass.hue}, 70%, ${lightness}%)`,
        WeaponClass,
        upgrades,
        name: loadout.name,
        highlight: loadout.highlight,
        skin: loadout.skin ?? null,
        tag: loadout.tag ?? null,
        size: this.royale ? loadout.size : 1,
        arena: this.arena,
      });
    });
  }

  // Balls still in the fight, in slot order. Read many times a step, so it's
  // cached, and replaced (never changed in place) when a ball goes down, so a
  // loop over the old one carries on as before. Don't modify it.
  get aliveBalls() {
    for (const ball of this.alive) {
      if (!ball.alive) {
        this.alive = this.balls.filter((b) => b.alive);
        break;
      }
    }
    return this.alive;
  }

  step(dt) {
    this.time += dt;
    const balls = this.aliveBalls;

    for (const ball of balls) ball.update(dt, this);
    for (const ball of balls) {
      if (!bounceOffWalls(ball, this.arena)) continue;
      ball.registerWallBounce(this);
      if (this.wallWatchers.length > 0) this.tellWallWatchers(ball);
    }
    // Pairs that might touch this step (see broadphase.js). A royale only
    // checks balls near each other; the margin covers the bumps below.
    const near = this.royale ? sweepNear(balls, NEAR_MARGIN) : allNear(balls.length);
    for (let i = 0; i < balls.length; i++) {
      for (const j of near[i]) {
        if (j <= i) continue;
        const a = balls[i];
        const b = balls[j];
        if (!resolveBallCollision(a, b)) continue;
        a.weapon.registerBump(b, this);
        b.weapon.registerBump(a, this);
      }
    }

    // Once the match is decided the winner keeps bouncing around, but nothing fights.
    if (!this.over) this.resolveCombat(balls, near);
    if (!this.over) this.applySuddenDeath();
  }

  get inSuddenDeath() {
    return this.suddenDeathAt != null && this.time >= this.suddenDeathAt - TIME_EPSILON;
  }

  // Past the sudden death time every ball loses HP on a timer, more each tick
  // (CONFIG.suddenDeath), so lifesteal and regen can't hold out for long. Balls
  // take it lowest HP first, as if it drained continuously: once one ball is
  // left the rest of the tick is skipped, so the ball with the most HP outlasts
  // the others, and only balls level on HP go down together.
  applySuddenDeath() {
    if (!this.inSuddenDeath) return;
    const { interval, damage, ramp } = CONFIG.suddenDeath;
    if (this.time < this.suddenDeathAt + this.suddenDeathTicks * interval - TIME_EPSILON) return;
    const amount = damage + ramp * this.suddenDeathTicks++;

    let knockedOutAt = 0; // HP the last ball knocked out this tick had
    for (const ball of [...this.aliveBalls].sort((a, b) => a.hp - b.hp)) {
      if (this.aliveBalls.length < 2 && ball.hp > knockedOutAt) break;
      const hp = ball.hp;
      this.dealDamage(null, ball, amount, { reason: 'sudden-death', color: SUDDEN_DEATH_COLOR });
      if (!ball.alive) knockedOutAt = hp;
    }
    this.checkForWinner();
  }

  // `near[i]` lists the balls that might touch balls[i], in slot order (see broadphase.js).
  resolveCombat(balls, near = allNear(balls.length)) {
    // Weapons that are touching another weapon are blocked this step and can't hit:
    // they're marked with this round's number (quicker than a Set every step).
    const round = ++this.combatRound;

    for (let i = 0; i < balls.length; i++) {
      for (const j of near[i]) {
        if (j <= i) continue;
        const a = balls[i];
        const b = balls[j];
        if (a.weapon.unblockable || b.weapon.unblockable || a.guardBroken || b.guardBroken) continue;
        // A weapon that doesn't clash right now swings through; the other is still stopped by it.
        const aClashes = a.weapon.clashesWith(b.weapon);
        const bClashes = b.weapon.clashesWith(a.weapon);
        if (!aClashes && !bClashes) continue;
        const point = weaponsClash(a.weapon, b.weapon);
        if (!point) continue;
        if (aClashes) a.weapon.blockedRound = round;
        if (bClashes) b.weapon.blockedRound = round;
        if (aClashes && bClashes && a.weapon.canParry(b.weapon) && b.weapon.canParry(a.weapon)) {
          this.applyParry(a, b, point);
        }
      }
    }

    // Enemy weapons touching a shield are blocked too.
    for (let d = 0; d < balls.length; d++) {
      const defender = balls[d];
      if (defender.guardBroken) continue;
      for (const shield of defender.weapon.heldShields) {
        for (const a of near[d]) {
          const attacker = balls[a];
          if (attacker === defender || attacker.weapon.unblockable) continue;
          const point = weaponHitsShield(attacker.weapon, shield);
          if (!point) continue;
          attacker.weapon.blockedRound = round;
          if (attacker.weapon.canParry(defender.weapon)) this.applyBlock(attacker, defender, point);
        }
      }
    }

    // Spiked shields (and off-hand swords) hurt enemy balls they touch.
    for (let d = 0; d < balls.length; d++) {
      const defender = balls[d];
      for (const shield of defender.weapon.heldShields) {
        if (!shield.contactDamage) continue;
        for (const t of near[d]) {
          const target = balls[t];
          if (target === defender || !defender.alive || !target.alive || !target.canBeHitBy(shield)) continue;
          const point = shieldHitsBall(shield, target);
          if (!point) continue;
          target.hitCooldowns.set(shield, CONFIG.combat.hitCooldown);
          this.applySecondaryHit(defender, target, shield.contactDamage, { reason: shield.contactReason, color: shield.contactColor, point });
        }
      }
    }

    // A ball killed earlier in this step still swings: simultaneous hits trade, whatever the slot order.
    for (let a = 0; a < balls.length; a++) {
      const attacker = balls[a];
      if (attacker.weapon.blockedRound === round) continue;
      for (const t of near[a]) {
        const target = balls[t];
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

    const crit = weapon.rollCrit(point);
    const raw = crit ? weapon.getDamage(point) * weapon.critMultiplier + weapon.sum('critBonusDamage') : weapon.getDamage(point);
    const damage = target.reduceDamage(raw * attacker.damageDealtMultiplier);
    if (target.weapon.absorbsDamage(attacker, damage, this)) {
      target.hitCooldowns.set(weapon, CONFIG.combat.hitCooldown);
      return;
    }
    const dealt = target.takeHit(weapon, damage);

    // Launch the target directly away from where it was struck. A weapon that
    // only nudges (Drone) adds that push to how the target was already moving.
    // No knockback at all (a saw's teeth) leaves its movement alone.
    const knockback = weapon.knockbackMultiplier;
    if (knockback > 0) {
      const away = sub(target.pos, point);
      const n = normalize(away.x || away.y ? away : sub(target.pos, attacker.pos));
      const push = scale(n, target.speed * CONFIG.combat.knockback * knockback);
      target.vel = weapon.nudges ? add(target.vel, push) : push;
    }

    this.onEvent('hit', { attacker, target, damage, dealt, crit, point });
    if (!target.alive) this.knockOut(target, attacker);
    target.weapon.registerOwnerHit(weapon, this, damage);
    weapon.lastHitCrit = crit;
    weapon.registerHit(target, this, damage, point);
  }

  // `ball` bounced off a wall: tell every other living ball's upgrades that listen.
  tellWallWatchers(ball) {
    for (const watcher of this.wallWatchers) {
      if (watcher === ball || !watcher.alive || this.over) continue;
      for (const upgrade of watcher.weapon.upgradesWith('onOtherWallBounce')) upgrade.onOtherWallBounce(ball, this);
    }
  }

  // A hit from something of the attacker's other than its blade (a spiked
  // shield or off-hand sword touching a ball, Shield Bash, a thrown shield,
  // Kamikaze's explosion) that still counts as a weapon hit: it can be dodged or cancelled, crits,
  // is scaled by the weapon's upgrades (Sharpened, not the ability's swing
  // bonus), and the target's Armor and vulnerability apply. Lifesteal,
  // Sabotage and Thorns see it. Unlike a blade hit it has no knockback, sets
  // no hit cooldown on the blade, and doesn't grow the weapon: neither the
  // weapon's own onHit nor its ability's is called, and its upgrades get
  // `{ secondary: true, reason }` as onHit's last argument so they can tell.
  // Shown as a 'damage' event. `quiet` marks one of many small ticks (Pyromancer's
  // ring), which the game shows without a number or sound. Returns the damage dealt.
  // `upgradeScale` (below 1) shrinks what damage upgrades add to it: the extra
  // from upgrades' damage multipliers, crits and Sabotage (Pyromancer's ring).
  // `scatters: false` leaves the target's guard alone (a Drone's guarding
  // drones aren't knocked away by it: Bestial Worshipper's claws).
  applySecondaryHit(attacker, target, amount, { reason, color, point = target.pos, quiet = false, upgradeScale = 1, scatters = true } = {}) {
    if (!target.alive || amount <= 0) return 0;
    const weapon = attacker.weapon;
    if (target.dodges()) {
      this.onEvent('dodge', { attacker, target, point, quiet });
      return 0;
    }
    if (target.weapon.preventsHit(weapon, this)) return 0;
    const crit = weapon.rollCrit();
    const multiplier = weapon.upgradeMultiplier('damageMultiplier');
    let raw;
    if (upgradeScale === 1) {
      const scaled = amount * multiplier;
      raw = crit ? scaled * weapon.critMultiplier + weapon.sum('critBonusDamage') : scaled;
    } else {
      const scaled = amount * (1 + (multiplier - 1) * upgradeScale);
      raw = crit ? scaled * (1 + (weapon.critMultiplier - 1) * upgradeScale) + weapon.sum('critBonusDamage') * upgradeScale : scaled;
    }
    const damage = target.reduceDamage(raw * attacker.damageDealtMultiplier);
    if (target.weapon.absorbsDamage(attacker, damage, this)) return 0;
    const dealt = target.takeDamage(damage);
    this.onEvent('damage', { source: attacker, target, damage, dealt, reason, color, crit, quiet });
    if (!target.alive) this.knockOut(target, attacker);
    target.weapon.registerOwnerHit(weapon, this, damage, scatters);
    for (const upgrade of weapon.upgradesWith('onHit')) upgrade.onHit(target, this, damage, point, { secondary: true, reason, upgradeScale });
    return dealt;
  }

  // Damage that doesn't come from a weapon hit (thorns, spiked shields, burning...):
  // no knockback, no hit cooldown, and armor and dodging don't apply. Hooks
  // aren't triggered either, so thorns can't bounce off thorns forever. The
  // source's statuses still scale it (a stunned source deals less).
  dealDamage(source, target, damage, { reason, color } = {}) {
    if (source) damage *= source.damageDealtMultiplier;
    if (!target.alive || damage <= 0) return;
    if (source && source !== target && target.weapon.absorbsDamage(source, damage, this)) return;
    const dealt = target.takeDamage(damage);
    this.onEvent('damage', { source, target, damage, dealt, reason, color });
    if (!target.alive) this.knockOut(target, source);
  }

  // `killer` is the ball whose hit or damage finished `ball` off (null for
  // sudden death). In a royale it takes the victim's mass and grows.
  knockOut(ball, killer = null) {
    ball.knockedOutAt ??= this.time;
    this.onEvent('death', { ball });
    if (!this.royale || !killer || killer === ball) return;
    const factor = killer.grow(ball.mass, CONFIG.royale);
    this.onEvent('grow', { ball: killer, victim: ball, factor });
  }

  // Ends the match with no winner, e.g. when it runs past a time limit.
  endInDraw() {
    if (this.over) return;
    this.end(null);
  }

  // The time limit ran out. With the 'hp' tiebreak the fighter with the most
  // HP left (as a share of max HP) wins; otherwise it's a draw.
  endOnTime() {
    if (this.over) return;
    if (this.tiebreak === 'hp') this.end(this.leaderOnHp(), 'hp');
    else this.end(null);
  }

  checkForWinner() {
    const alive = this.aliveBalls;
    if (alive.length > 1) return;
    // Everyone went down in the same step. With a tiebreak there is still a winner.
    if (alive.length === 0 && this.tiebreak === 'hp') this.end(this.leaderOnHp(), 'hp');
    else this.end(alive[0] ?? null);
  }

  // The ball with the largest share of its max HP. An exact tie (e.g. a double
  // KO) is a coin flip, through Math.random so a seeded match stays reproducible.
  leaderOnHp() {
    const share = (ball) => ball.hp / ball.maxHp;
    const best = Math.max(...this.balls.map(share));
    const leaders = this.balls.filter((ball) => share(ball) === best);
    return leaders.length === 1 ? leaders[0] : leaders[Math.floor(Math.random() * leaders.length)];
  }

  // Fighter indices from first place to last: the winner, then any others
  // still standing (most HP share first), then the knocked out, last out first.
  get ranking() {
    const place = (ball) => [ball === this.winner ? 1 : 0, ball.alive ? 1 : 0, ball.alive ? ball.hp / ball.maxHp : (ball.knockedOutAt ?? -1)];
    const order = this.balls.map((ball, i) => ({ i, key: place(ball) }));
    order.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2] || a.i - b.i);
    return order.map(({ i }) => i);
  }

  end(winner, decidedBy = 'ko') {
    this.over = true;
    this.winner = winner;
    this.decidedBy = winner ? decidedBy : null;
    this.onEvent('end', { winner, decidedBy: this.decidedBy });
  }
}

// A royale's arena: square, with CONFIG.royale.spacing of side per sqrt(ball),
// and never smaller than the normal one.
function royaleArena(count) {
  const side = Math.max(CONFIG.arena.width, Math.round(CONFIG.royale.spacing * Math.sqrt(count)));
  return { width: side, height: side };
}

// When sudden death starts in a royale of `count` balls, in sim seconds.
export function royaleSuddenDeath(count) {
  const { base, perBall } = CONFIG.royale.suddenDeath;
  return base + perBall * count;
}

// Spawn points for a royale: the arena cut into a near-square grid of cells,
// one ball per cell (filled in reading order), each nudged randomly inside its
// cell so the crowd doesn't start in neat rows. Returns slot index -> position.
function royaleGrid(count, arena) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = arena.width / cols;
  const h = arena.height / rows;
  const jitterX = Math.max(0, w / 2 - CONFIG.ball.radius * 1.1);
  const jitterY = Math.max(0, h / 2 - CONFIG.ball.radius * 1.1);
  return (i) => ({
    x: (i % cols + 0.5) * w + (Math.random() * 2 - 1) * jitterX,
    y: (Math.floor(i / cols) + 0.5) * h + (Math.random() * 2 - 1) * jitterY,
  });
}

const SUDDEN_DEATH_COLOR = '#ff4d4d';
// Arena units added to every ball's reach when a royale finds the pairs near
// each other, for balls pushed apart by bumps in the same step.
const NEAR_MARGIN = 20;
// sim.time is a sum of fixed steps, so it lands a hair off whole seconds.
const TIME_EPSILON = 1e-6;
