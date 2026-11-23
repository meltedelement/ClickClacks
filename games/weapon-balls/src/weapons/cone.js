import { scaledRange } from '../sim/targeting.js';

// Draws a weapon's detection cone: a translucent wedge from the ball's centre
// out along the weapon's angle, brighter while the weapon has locked on.
// Presentation only (called from Weapon.drawUnder, never by the sim).
export function drawCone(ctx, weapon, locked) {
  const { owner } = weapon;
  const range = scaledRange(owner, weapon.coneRange);
  ctx.save();
  ctx.fillStyle = owner.color;
  ctx.globalAlpha = locked ? 0.26 : 0.12;
  ctx.beginPath();
  ctx.moveTo(owner.pos.x, owner.pos.y);
  ctx.arc(owner.pos.x, owner.pos.y, range, weapon.angle - weapon.coneHalfAngle, weapon.angle + weapon.coneHalfAngle);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = locked ? 0.5 : 0.25;
  ctx.strokeStyle = owner.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}
