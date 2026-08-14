// Shatter — a small seedable pseudo-random generator.
//
// The whole simulation draws its randomness (a rock's spawn position and drift,
// the saucer's entry and aim, a rock's cosmetic outline and spin) from this one
// generator, so reseeding it and replaying the same sequence of calls reproduces
// the same game exactly. The debug API reseeds it in reset({ seed }) (see
// debug.ts and specs/instrumentation.md); normal play leaves it on its default
// seed. Only cosmetic, state-free randomness that never touches the simulation
// (the audio noise buffer, the thrust-flame flicker) still uses Math.random.

// mulberry32: a compact, fast 32-bit generator, ample for gameplay randomness.
let state = 0x9e3779b9 >>> 0;

// Seed all of the game's randomness. A falsy seed is nudged to 1 so the stream
// never degenerates.
export function seedRng(seed: number): void {
  state = (seed >>> 0) || 1;
}

// The next float in [0, 1).
export function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
