// Floe — when a countdown has run out.
//
// `specs/overview.md` fixes the tick as the game's whole clock: every rate is per
// second, every duration is in seconds, and both are integrated in whole ticks of
// `TICK_DT`. A countdown is therefore spent on the FIRST TICK THAT REACHES ZERO,
// and this module is the one place that decides what "reaches zero" means.
//
// It means zero, up to the noise of counting a float down. Every duration in
// `src/constants.ts` but one is a whole number of ticks — `DEATH_PAUSE` (`0.9` s)
// is `108`, `BEAR_EMERGE_DELAY` (`0.6` s) is `72`, `FISH_LINGER` (`5` s) is `600`,
// a level-1 crossing (`30` s) is `3600` — and subtracting `1/120` that many times
// lands a quadrillionth either side of zero rather than on it. A hold that reports
// itself still running because `1.7e-18` s is left has simply mis-integrated its
// own duration, so the comparison absorbs that much and no more.
//
// It absorbs no more on purpose. `HOP_COOLDOWN` (`0.12` s) is `14.4` ticks, which
// no whole number of ticks reaches exactly, and `specs/hopping.md` says a press
// while the cooldown is running is ignored: the cooldown is therefore spent on the
// fifteenth tick, the first tick at which none of it is left, rather than on the
// fourteenth, which is still `0.4` of a tick short of the figure.

/**
 * The remainder below which a countdown has run out.
 *
 * A whole number of ticks of accumulated rounding, and nothing that could stand
 * for a real part of a tick: `TICK_DT` is `8.3` ms and this is `1` ns.
 */
export const SPENT = 1e-9;

/** Whether a countdown holding `remaining` seconds has run out. */
export function expired(remaining: number): boolean {
  return remaining <= SPENT;
}
