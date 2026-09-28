import { Ability } from './Ability.js';
import { TAU, clamp, turnTowards, vec } from '../sim/math.js';

const COOLDOWN = 5;
const MIN_DROP_HEIGHT = 200; // px above the floor the ball must be to start a slam
const HOVER_TIME = 0.25; // seconds hanging in the air while the weapon swings out sideways
const START_SPEED = 150; // px/s downward when the drop begins
const GRAVITY = 2800; // px/s² the drop accelerates by
const STEER_SPEED = 220; // max px/s of sideways drift to line the weapon up with the enemy
const MAX_DROP_TIME = 1.5; // safety net in case it somehow never lands
const DAMAGE_PER_PX = 1 / 80; // +100% damage for every 80 px fallen
const KNOCKBACK_MULTIPLIER = 1.4;

// Once high enough, hover, hold the weapon out towards the enemy's side, then
// plunge straight down to the floor. Nothing stops the fall: the weapon can't
// be parried and the ball shoves through anything in its way. The further it
// has fallen when it connects, the harder it hits.
export class DropSlam extends Ability {
  static displayName = 'Drop Slam';

  constructor(weapon) {
    super(weapon, { cooldown: COOLDOWN });
    this.phase = null; // 'hover' | 'drop'
    this.timer = 0;
    this.side = 1; // 1 = weapon held out to the right, -1 = left
    this.startY = 0;
    this.fallSpeed = 0;
    this.target = null;
  }

  get fallen() {
    return this.phase === 'drop' ? Math.max(0, this.owner.pos.y - this.startY) : 0;
  }

  get spinMultiplier() {
    return this.active ? 0 : 1;
  }

  get damageMultiplier() {
    return this.phase === 'drop' ? 1 + this.fallen * DAMAGE_PER_PX : 1;
  }

  get knockbackMultiplier() {
    return this.phase === 'drop' ? KNOCKBACK_MULTIPLIER : 1;
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
    const floor = sim.arena.height - this.owner.radius;
    return floor - this.owner.pos.y >= MIN_DROP_HEIGHT;
  }

  onStart(sim) {
    this.target = this.nearestEnemy(sim);
    this.side = this.target ? Math.sign(this.target.pos.x - this.owner.pos.x) || 1 : 1;
    this.phase = 'hover';
    this.timer = HOVER_TIME;
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
        this.fallSpeed = START_SPEED;
        owner.vel = vec(0, START_SPEED);
        weapon.angle = sideAngle;
      }
      return;
    }

    this.fallSpeed += GRAVITY * dt;

    // Land as soon as the next step would reach the floor.
    const floor = sim.arena.height - owner.radius;
    if (owner.pos.y + this.fallSpeed * dt >= floor) {
      owner.pos.y = floor;
      this.land(sim);
      return;
    }

    let drift = 0;
    if (this.target?.alive) {
      const idealX = this.target.pos.x - this.side * (owner.radius + weapon.gap + weapon.length * 0.6);
      drift = clamp((idealX - owner.pos.x) * 5, -STEER_SPEED, STEER_SPEED);
    }
    owner.vel = vec(drift, this.fallSpeed);
    weapon.angle = sideAngle;

    if (this.timer <= 0) this.end(sim);
  }

  land(sim) {
    const { owner } = this;
    this.emit(sim, 'slam', {
      shake: 3 + this.fallen * 0.015,
      burst: { color: '#b9a88f', count: 18, speed: 240, life: 0.5 },
    });
    owner.vel = vec(0, -owner.speed);
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
    const progress = 1 - this.timer / HOVER_TIME;
    const x = owner.pos.x + this.side * (owner.radius + weapon.gap + weapon.length);

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.3 * progress;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x, owner.pos.y);
    ctx.lineTo(x, 10000);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25 + 0.6 * progress;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(owner.pos.x, owner.pos.y, owner.radius + 4 + 12 * (1 - progress), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Afterimages trailing above the falling ball.
  drawDrop(ctx) {
    const { owner } = this;
    ctx.save();
    ctx.fillStyle = owner.color;
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha = 0.3 * (1 - i / 5);
      ctx.beginPath();
      ctx.arc(owner.pos.x, owner.pos.y - this.fallSpeed * 0.018 * i, owner.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
