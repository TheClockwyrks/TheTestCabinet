// Spectra — a small seedable pseudo-random generator (mulberry32).
//
// All of the game's randomness (which drone dives next, the dive gap, a Flux's
// starting phase, an Overload escort's band) runs through one of these, so
// reseeding via the debug API's reset({ seed }) and replaying the same calls
// reproduces the same run exactly. See specs/instrumentation.md.

export const DEFAULT_SEED = 0x5c0e; // the seed a bare reset() re-arms

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
