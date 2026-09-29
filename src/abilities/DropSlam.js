import { Ability } from './Ability.js';
import { TAU, clamp, turnTowards, vec } from '../sim/math.js';

const MAX_DROP_TIME = 1.5; // safety net in case it somehow never lands

// Once high enough, hover, hold the weapon out towards the enemy's side, then
// plunge straight down to the floor. Nothing stops the fall: the weapon can't
// be parried and the ball shoves through anything in its way. The further it
// has fallen when it connects, the harder it hits.
//
// Upgrades can also let it rise instead (`canRise`, from low down, up to the
// ceiling) and loop through the floor and out of the ceiling (`wraps`). Where
// it hit the floor or ceiling is kept in `landing` until the next slam starts,
// so upgrades can react to it in onAbilityEnd.
export class DropSlam extends Ability {
  static displayName = 'Drop Slam';

  constructor(weapon) {
    super(weapon, { cooldown: 5 });

    // Stats. Upgrades may change these.
    this.minDropHeight = 200; // px above the floor the ball must be to start a slam
    this.hoverTime = 0.25; // seconds hanging in the air while the weapon swings out sideways
    this.startSpeed = 150; // px/s downward when the drop begins
    this.gravity = 2800; // px/s² the drop accelerates by
    this.steerSpeed = 220; // max px/s of sideways drift to line the weapon up with the enemy
    this.damagePerPx = 1 / 80; // +100% damage for every 80 px fallen
    this.slamKnockbackMultiplier = 1.4;
    this.landBounce = 1; // upward speed after landing, as a multiple of the ball's speed
    this.canRise = false; // true: from low down, fly up to the ceiling instead (Pilot)
    this.wraps = 0; // times each slam goes through the floor and comes out of the ceiling before landing (Portaler)

    this.phase = null; // 'hover' | 'drop'
    this.timer = 0;
    this.side = 1; // 1 = weapon held out to the right, -1 = left
    this.dir = 1; // 1 = falling to the floor, -1 = rising to the ceiling
    this.wrapsLeft = 0;
    this.startY = 0;
    this.fallSpeed = 0;
    this.target = null;
    this.landing = null; // { pos, dir, fallen, tips } from the last slam that reached the floor or ceiling
  }

  // Distance travelled since the drop began (rising counts too).
  get fallen() {
    return this.phase === 'drop' ? Math.max(0, (this.owner.pos.y - this.startY) * this.dir) : 0;
  }

  get spinMultiplier() {
    return this.active ? 0 : 1;
  }

  get damageMultiplier() {
    return this.phase === 'drop' ? 1 + this.fallen * this.damagePerPx : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'drop' ? this.slamKnockbackMultiplier : 1;
  }

  get controlsMovement() {
    return this.active;
  }

  get unblockable() {
    return this.phase === 'drop';
  }

  get unstoppable() {
    return this.phase === 'drop';
  }

  shouldActivate(sim) {
    return this.chooseDirection(sim) !== 0;
  }

  // 1 to slam down to the floor, -1 to rise to the ceiling, 0 if there's no room for either.
  chooseDirection(sim) {
    const { owner } = this;
    if (sim.arena.height - owner.radius - owner.pos.y >= this.minDropHeight) return 1;
    if (this.canRise && owner.pos.y - owner.radius >= this.minDropHeight) return -1;
    return 0;
  }

  onStart(sim) {
    this.target = this.nearestEnemy(sim);
    this.side = this.target ? Math.sign(this.target.pos.x - this.owner.pos.x) || 1 : 1;
    this.dir = this.chooseDirection(sim) || 1;
    this.wrapsLeft = this.wraps;
    this.landing = null;
    this.phase = 'hover';
    this.timer = this.hoverTime;
  }

  onUpdate(dt, sim) {
    const { owner, weapon } = this;
    const sideAngle = this.side > 0 ? 0 : Math.PI;
    this.timer -= dt;

    if (this.phase === 'hover') {
      owner.vel = vec(0, 0);
      weapon.angle = turnTowards(weapon.angle, sideAngle, 20 * dt);
      if (this.timer <= 0) {
        this.phase = 'drop';
        this.timer = MAX_DROP_TIME;
        this.startY = owner.pos.y;
        this.fallSpeed = this.startSpeed;
        owner.vel = vec(0, this.startSpeed * this.dir);
        weapon.angle = sideAngle;
      }
      return;
    }

    this.fallSpeed += this.gravity * dt;

    // Land (or go through a portal) as soon as the next step would reach the floor.
    const end = this.dir > 0 ? sim.arena.height - owner.radius : owner.radius;
    if ((owner.pos.y + this.fallSpeed * this.dir * dt - end) * this.dir >= 0) {
      if (this.wrapsLeft > 0) {
        this.wrap(sim, end);
      } else {
        owner.pos.y = end;
        this.land(sim);
        return;
      }
    }

    let drift = 0;
    if (this.target?.alive) {
      const idealX = this.target.pos.x - this.side * (owner.radius + weapon.gap + weapon.length * 0.6);
      drift = clamp((idealX - owner.pos.x) * 5, -this.steerSpeed, this.steerSpeed);
    }
    owner.vel = vec(drift, this.fallSpeed * this.dir);
    weapon.angle = sideAngle;

    if (this.timer <= 0) this.end(sim);
  }

  // Through the floor and out of the ceiling (or the other way round when
  // rising), still falling just as fast. The height counts again from there.
  wrap(sim, end) {
    const { owner } = this;
    const start = this.dir > 0 ? owner.radius : sim.arena.height - owner.radius;
    this.startY = start;
    owner.pos.y = start;
    this.wrapsLeft -= 1;
    this.timer = MAX_DROP_TIME;
    this.emit(sim, 'portal', { burst: { color: '#ff9f2e', count: 14, speed: 200, life: 0.4 } });
  }

  land(sim) {
    const { owner, weapon } = this;
    this.landing = {
      pos: { ...owner.pos },
      dir: this.dir,
      fallen: this.fallen,
      tips: weapon.getSegments().map(({ b }) => b), // where each blade's head came down
    };
    this.emit(sim, 'slam', {
      shake: 3 + this.fallen * 0.015,
      burst: { color: '#b9a88f', count: 18, speed: 240, life: 0.5 },
    });
    owner.vel = vec(0, -this.dir * owner.speed * this.landBounce);
    this.end(sim);
  }

  onEnd() {
    this.phase = null;
    this.target = null;
  }

  draw(ctx) {
    if (this.phase === 'hover') this.drawHover(ctx);
    else if (this.phase === 'drop') this.drawDrop(ctx);
  }

  // Faint line showing where the weapon head will fall.
  drawHover(ctx) {
    const { owner, weapon } = this;
    const progress = 1 - this.timer / this.hoverTime;
    const x = owner.pos.x + this.side * (owner.radius + weapon.gap + weapon.length);

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.3 * progress;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x, owner.pos.y);
    ctx.lineTo(x, this.dir * 10000);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25 + 0.6 * progress;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 4 + 12 * (1 - progress), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Afterimages trailing behind the falling (or rising) ball.
  drawDrop(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha = 0.3 * (1 - i / 5);
      ctx.beginPath();
      ctx.arc(owner.pos.x, owner.pos.y - this.dir * this.fallSpeed * 0.018 * i, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
