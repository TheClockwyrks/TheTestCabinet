// Floe — when a countdown has run out.
//
// `specs/overview.md` fixes the tick as the game's whole clock: "every duration is
// in seconds, and both are integrated in whole ticks of that length". A duration is
// therefore reached at the nearest whole tick to it, and that is what this module
// says.
//
// Two things make the reading necessary rather than pedantic. Most of Floe's
// durations are a whole number of ticks — `DEATH_PAUSE` (`0.9` s) is `108`,
// `BEAR_EMERGE_DELAY` (`0.6` s) is `72`, `FISH_LINGER` (`5` s) is `600` — and a
// float counted down one `1/120` at a time lands a hair either side of zero rather
// than on it, so a hold that reports itself still running because of a
// quadrillionth of a second is simply wrong. And `HOP_COOLDOWN` (`0.12` s) is
// `14.4` ticks, which no whole number of ticks reaches exactly: the cooldown is
// spent on the fourteenth tick, the nearest whole tick to the figure, rather than
// held for a fifteenth over a remainder a third of a tick long.

import { TICK_DT } from "./constants";

/**
 * The remainder below which a countdown has run out: half a tick.
 *
 * Half a tick is the whole of the rounding, in both directions: a remainder under
 * it is nearer to zero than to a tick, and one over it is nearer to a tick.
 */
export const SPENT = TICK_DT / 2;

/** Whether a countdown holding `remaining` seconds has run out. */
export function expired(remaining: number): boolean {
  return remaining <= SPENT;
}
