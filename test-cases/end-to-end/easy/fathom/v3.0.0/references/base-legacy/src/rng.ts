// Fathom — a tiny seedable pseudo-random generator (mulberry32). All of the
// game's randomness (predator and drifter wander, the bonus-drifter spawn
// cadence) runs off one of these so that reseeding and replaying the same calls
// reproduces the same result exactly (specs/instrumentation.md). Ordinary play
// simply seeds it once at startup; the debug API reseeds it on reset({ seed }).
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
