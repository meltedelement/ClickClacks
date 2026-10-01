import { TAU, add, fromAngle, sub } from '../sim/math.js';

const SPIKES = 3;

// Colours for each shield look, from the outside of the plate in.
const LOOKS = {
  wood: { rim: '#c3c9d1', face: '#8a6a3f', boss: '#c3c9d1' },
  bronze: { rim: '#8c5a1c', face: '#d9a441', boss: '#8c5a1c' }, // Hoplite
  // 'captain' (Captain) has its own drawing: see drawCaptainShield
};
const CAPTAIN_RINGS = [['#d62b2b', 1], ['#f4f4f4', 0.78], ['#d62b2b', 0.58], ['#2a55c9', 0.4]];

// An off-hand shield: a curved plate just outside the ball that sits at a fixed
// angle from its weapon and turns with it. Enemy weapons that touch it are
// blocked. With `contactDamage` set, it also hurts enemy balls it touches.
// Give a weapon some with `this.shields = [new Shield(this, { ... })]`.
export class Shield {
  constructor(weapon, { offset, distance = 7, width = 40, thickness = 5 }) {
    this.weapon = weapon;
    this.offset = offset; // radians from the weapon; negative = to the weapon's left
    this.distance = distance; // px between the ball's surface and the shield
    this.width = width; // px across
    this.thickness = thickness; // hitbox half-width, px
    this.contactDamage = 0; // damage to enemy balls that touch the shield; 0 = harmless
    this.contactReason = 'spikes'; // `reason` of that damage, for the 'damage' event
    this.contactColor = '#c3c9d1';
    this.spikeLength = 0; // px of extra reach towards balls, for spikes on the face
    this.away = false; // true while it's out of the owner's hands (thrown): it can't block or hurt
    this.style = 'wood'; // 'wood' | 'bronze' (Hoplite) | 'captain' (Captain); see LOOKS
  }

  // Royale growth: see Weapon.scaleGeometry.
  scaleGeometry(factor) {
    this.distance *= factor;
    this.width *= factor;
    this.thickness *= factor;
    this.spikeLength *= factor;
  }

  saveGeometry() {
    return { distance: this.distance, width: this.width, thickness: this.thickness, spikeLength: this.spikeLength };
  }

  restoreGeometry(saved) {
    Object.assign(this, saved);
  }

  get angle() {
    return this.weapon.angle + this.offset;
  }

  get radius() {
    return this.weapon.owner.radius + this.distance;
  }

  // A second shield like this one (same kind, size and upgrades), e.g. for an extra off-hand.
  clone() {
    const { offset, distance, width, thickness } = this;
    const copy = new this.constructor(this.weapon, { offset, distance, width, thickness });
    copy.contactDamage = this.contactDamage;
    copy.spikeLength = this.spikeLength;
    copy.style = this.style;
    return copy;
  }

  // How far from the ball's centre the shield's hitbox can reach (thickness
  // included, spikes not). Must match getSegment; see Weapon.bladeReach.
  get reach() {
    return Math.hypot(this.radius, this.width / 2) + this.thickness;
  }

  // Straight segment across the face of the shield, in arena coordinates.
  getSegment() {
    const center = add(this.weapon.owner.pos, fromAngle(this.angle, this.radius));
    const across = fromAngle(this.angle + Math.PI / 2, this.width / 2);
    return { a: sub(center, across), b: add(center, across) };
  }

  draw(ctx) {
    if (this.away) return;
    const { x, y } = this.weapon.owner.pos;
    const halfArc = this.width / 2 / this.radius;
    const from = this.angle - halfArc;
    const to = this.angle + halfArc;

    if (this.style === 'captain') {
      drawCaptainShield(ctx, add({ x, y }, fromAngle(this.angle, this.radius)), this.angle, this.width / 2);
    } else {
      const look = LOOKS[this.style];
      ctx.save();
      ctx.lineCap = 'round';
      // Metal rim
      ctx.strokeStyle = look.rim;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(x, y, this.radius, from, to);
      ctx.stroke();
      // Face
      ctx.strokeStyle = look.face;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(x, y, this.radius, from, to);
      ctx.stroke();
      // Boss in the middle
      const boss = add({ x, y }, fromAngle(this.angle, this.radius));
      ctx.fillStyle = look.boss;
      ctx.beginPath();
      ctx.arc(boss.x, boss.y, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (this.spikeLength > 0) this.drawSpikes(ctx);
  }

  // Spikes sticking out of the shield's face.
  drawSpikes(ctx) {
    const out = fromAngle(this.angle, 1);
    const across = fromAngle(this.angle + Math.PI / 2, 1);
    const face = add(this.weapon.owner.pos, fromAngle(this.angle, this.radius + 4));

    ctx.save();
    ctx.fillStyle = '#c3c9d1';
    for (let i = 0; i < SPIKES; i++) {
      const t = (i / (SPIKES - 1) - 0.5) * this.width * 0.7;
      const base = add(face, { x: across.x * t, y: across.y * t });
      const tip = add(base, { x: out.x * (this.spikeLength + 2), y: out.y * (this.spikeLength + 2) });
      ctx.beginPath();
      ctx.moveTo(base.x + across.x * 3, base.y + across.y * 3);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(base.x - across.x * 3, base.y - across.y * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Drawn flying through the air at `pos`, turned `spin` radians (see the Captain upgrade).
  drawThrown(ctx, pos, spin) {
    const r = this.width / 2;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(spin);
    if (this.style === 'captain') {
      ctx.restore();
      drawCaptainShield(ctx, pos, spin, r, r);
      return;
    }
    const look = LOOKS[this.style];
    ctx.fillStyle = look.face;
    ctx.strokeStyle = look.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();
    ctx.fillStyle = look.boss;
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawHitbox(ctx) {
    if (this.away) return;
    const { a, b } = this.getSegment();
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 180, 255, 0.6)';
    ctx.lineWidth = this.thickness * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

// A round shield centred on `pos`: red, white and red rings round a blue
// centre with a white star. Held, it's squashed to `depth` px along `angle`
// (pointing out from the ball) so it stays inside the hitbox.
function drawCaptainShield(ctx, pos, angle, r, depth = 8) {
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);
  for (const [color, share] of CAPTAIN_RINGS) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, depth * share, r * share, 0, 0, TAU);
    ctx.fill();
  }
  ctx.scale(depth / r, 1);
  ctx.fillStyle = '#ffffff';
  drawStar(ctx, { x: 0, y: 0 }, r * 0.36, -Math.PI / 2);
  ctx.restore();
}

// A five-pointed star centred on (x, y), with one point along `angle`.
function drawStar(ctx, { x, y }, r, angle) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = angle + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}
