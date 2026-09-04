// Meltdown — the game's only source of randomness.
//
// One vent draw per released unit, and nothing else (specs/waves.md). The whole
// generator state is a single 32-bit word held in the game's state, so reseeding
// and replaying the same calls reproduces the same sequence exactly — which is
// what `specs/instrumentation.md` means by a deterministic core.
//
// The algorithm is mulberry32: one multiply-xor-shift chain over a counter. It is
// not cryptographic and does not need to be; it needs to be fast, seedable from
// one number, and identical on every machine, which 32-bit integer arithmetic in
// JavaScript is.

/** The generator's whole state: one 32-bit word. */
export interface Rng {
  seed: number;
}

/** A generator at `seed`, folded into 32 bits so any number is a valid seed. */
export function createRng(seed: number): Rng {
  return { seed: seed >>> 0 };
}

/**
 * The next value in `[0, 1)`, advancing the generator in place.
 *
 * In place because the caller is the game's own update, which holds the
 * generator as a field: threading a new generator through every call site would
 * buy nothing and would make it easy to drop an advance on the floor.
 */
export function nextFloat(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One of `count` outcomes, each equally likely. */
export function nextInt(rng: Rng, count: number): number {
  return Math.floor(nextFloat(rng) * count);
}
