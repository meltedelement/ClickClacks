// Seeded stand-in for Math.random (mulberry32). The sim only ever calls
// Math.random, so swapping this in for a match makes it play out the same way
// every time: in the balance tool, and on every screen showing a queued match.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
