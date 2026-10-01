// Which balls are close enough to touch each other this step, so the pair
// loops in Simulation only look at those. A normal match has a handful of
// balls and checks every pair; a royale has hundreds, and checking every pair
// four times a step is most of its running time.
//
// Returns `near`, where near[i] lists the indices (into `balls`) of the balls
// that might touch balls[i] (its body, blades or shields touching theirs),
// ascending, sometimes including i itself. Callers skip i and whatever else
// they don't want, so the lists can be shared.

// Every ball near every other: one shared list per size of match.
const everyone = new Map();

export function allNear(count) {
  let near = everyone.get(count);
  if (!near) {
    const all = Array.from({ length: count }, (_, i) => i);
    near = new Array(count).fill(all);
    everyone.set(count, near);
  }
  return near;
}

// Sort and sweep along x: two balls can only touch if their reach circles
// overlap. `margin` (arena units) covers balls being pushed apart after the
// lists are made.
export function sweepNear(balls, margin) {
  const n = balls.length;
  const reach = new Float64Array(n);
  const order = new Array(n);
  for (let i = 0; i < n; i++) {
    reach[i] = interactionReach(balls[i]) + margin;
    order[i] = i;
  }
  order.sort((i, j) => balls[i].pos.x - reach[i] - (balls[j].pos.x - reach[j]));

  const near = new Array(n);
  for (let i = 0; i < n; i++) near[i] = [];
  for (let s = 0; s < n; s++) {
    const i = order[s];
    const a = balls[i].pos;
    const right = a.x + reach[i];
    for (let t = s + 1; t < n; t++) {
      const j = order[t];
      const b = balls[j].pos;
      // Everything further along the order starts further right still.
      if (b.x - reach[j] > right) break;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const r = reach[i] + reach[j];
      if (dx * dx + dy * dy >= r * r) continue;
      near[i].push(j);
      near[j].push(i);
    }
  }
  for (const list of near) if (list.length > 1) list.sort(ascending);
  return near;
}

// How far from its centre anything of this ball can touch another ball: its
// body, its blades, or its shields and their spikes.
function interactionReach(ball) {
  let reach = Math.max(ball.radius, ball.weapon.guardReach);
  for (const shield of ball.weapon.shields) reach = Math.max(reach, shield.reach + shield.spikeLength);
  return reach;
}

function ascending(a, b) {
  return a - b;
}
