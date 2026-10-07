// Spectra — the game's random draws.
//
// The draws the game makes are which drone dives next, the gap before the next
// dive, a Flux's starting band clock, the band an overloaded Prism's escort
// arrives on, and the scatter each drone-burst plays with, as the specification
// states each; this build also draws which slots of a wave's block hold which
// kind, which the specification leaves to it. Every draw runs off the host's own
// generator: nothing about a draw is part of `SpectraState`, and nothing reads
// one back.
//
// The starfield is the one layout that must NOT change between loads, so it is
// laid out from `scatter`, a fixed sequence hashed from a constant.

/** A draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A draw in `[lo, hi)`. */
export function randomRange(lo: number, hi: number): number {
  return lo + random() * (hi - lo);
}

/** A whole draw in `[lo, hi]` inclusive. */
export function randomInt(lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** A whole word for a burst's own particle simulation to scatter from. */
export function randomWord(): number {
  return Math.floor(random() * 0x7fffffff);
}

/** `items` shuffled, by a Fisher-Yates pass. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}

/**
 * The next value of a fixed sequence in `[0, 1)`, and the word that follows
 * `word`: one multiply-xor-shift round over a 32-bit counter, the same on every
 * load, for a layout that must not change between loads.
 */
export function scatter(word: number): readonly [number, number] {
  const next = (word + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
