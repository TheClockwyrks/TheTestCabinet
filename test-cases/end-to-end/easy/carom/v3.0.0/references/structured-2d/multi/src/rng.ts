// Carom — the game's seeded random generator.
//
// The only randomness Carom uses is the angle a ball launches on, and
// `specs/instrumentation.md` requires that it run off a SEEDABLE generator so a
// scenario reseeded with `reset({ seed })` and replayed reaches the same state.
//
// The generator's whole state is one 32-bit integer, kept as `rngState` on the
// game instance (`src/game.ts`) — the one framework object that outlives every
// level transition, which is what lets a reseeded replay cross the transition a
// match opens with. A draw is a function of that integer alone and returns the
// value drawn BESIDE the generator's next state, `[value, next]`. The caller
// stores `next` where the old state was; nothing here holds or advances
// anything of its own.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for an
 * angle, and — because every step is `Math.imul` and a shift — exactly
 * reproducible in any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * The next draw as an angle, uniform over the full circle, in radians.
 *
 * This is the whole of a launch's direction (specs/balls.md): every ball leaves
 * its home point on a fresh angle, the first launch of a match and every
 * relaunch alike, so the walls and the obstacles rather than a serve rule are
 * what turn a launch into live play.
 */
export function nextAngle(state: number): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [value * 2 * Math.PI, next];
}
