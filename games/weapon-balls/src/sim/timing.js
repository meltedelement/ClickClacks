// Abilities and timed upgrades don't fire on a metronome: each wait is
// stretched or shortened by up to `amount` at random, so two fighters with the
// same ability (Daggers against Daggers, say) don't parry, throw or dash at
// the same moments every time. Uses Math.random, so seeded matches stay reproducible.
export const TIMING_JITTER = 0.25;

export function jitter(seconds, amount = TIMING_JITTER) {
  return seconds * (1 + amount * (Math.random() * 2 - 1));
}
