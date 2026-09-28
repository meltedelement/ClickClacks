// A timed effect on a ball, usually put there by an enemy (a burn, a net...).
// Add one with `ball.addStatus(new SomeStatus(...))`. A ball holds at most one
// status of each class, so applying it again replaces (refreshes) the old one.
//
// Statuses are sim logic like upgrades: headless, Math.random only. Their
// draw() is called only by the Renderer, on top of the ball.
export class Status {
  // `source` is the ball that caused it, for damage credit.
  constructor({ source, duration }) {
    this.source = source;
    this.duration = duration; // seconds
    this.timeLeft = duration;
    this.age = 0; // seconds since applied; handy for animating
    this.ball = null; // set by Ball.addStatus
  }

  get expired() {
    return this.timeLeft <= 0;
  }

  // ---- Modifiers ----------------------------------------------------------------

  // Multiplies the speed the ball eases back towards.
  get speedMultiplier() {
    return 1;
  }

  // Multiplies damage the ball takes from weapon hits.
  get damageTakenMultiplier() {
    return 1;
  }

  // True while the ball's weapon and shields can't block: other weapons pass
  // straight through them (both ways) and nothing parries.
  get guardBroken() {
    return false;
  }

  // True while the ball can't deal damage: its weapon hits do nothing and its
  // non-weapon damage (spikes, thorns, burns it caused...) is skipped.
  get stunned() {
    return false;
  }

  // ---- Hooks ----------------------------------------------------------------

  onApply(sim) {} // just put on this.ball
  onUpdate(dt, sim) {} // every physics step until it expires
  onWallBounce(sim) {} // the ball bounced off a wall

  draw(ctx) {}

  // ---- Engine internals -------------------------------------------------------

  update(dt, sim) {
    this.age += dt;
    this.timeLeft -= dt;
    this.onUpdate(dt, sim);
  }
}
