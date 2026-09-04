// Shatter — the figures this build chose, which the specification leaves open.
//
// `src/constants.ts` is supplied with the project and holds every figure the
// specification FIXES. Nothing here is one of those. Each value below answers a
// requirement the specification states without a number, and each is named so
// the requirement it answers is obvious:
//
//   * `specs/scoring.md` — an extra ship being granted "is announced on the
//     field for at least half a second".
//   * `specs/saucer.md` — the saucer "steers clear of the star's core", and "how
//     far outside that it chooses to steer is the build's".
//   * `specs/rocks.md` — a rock "carries a slow drawn rotation for visual life",
//     with no rate stated, since the rotation is cosmetic.
//   * `specs/weapons.md` — a bullet leaves "from the ship's nose ... no further
//     from it than SHIP_R", which fixes a bound rather than a point.

import { SHIP_R } from "./constants";

/** How long the extra-ship announcement stays on the field, in seconds. */
export const EXTRA_LIFE_FLASH_TIME = 1.2;

/**
 * How near the star the saucer lets itself get before it steers away, in units.
 *
 * The specification fixes only that the saucer's circle never overlaps the core,
 * so its centre is never nearer than `CORE_R + SAUCER_R` (48). This is the
 * distance at which the steering starts, chosen with enough room that a saucer
 * crossing dead along the star's row at `SAUCER_SPEED` clears the core by a wide
 * margin using nothing faster than its own weave speed.
 */
export const SAUCER_AVOID_R = 200;

/** The fastest a rock's drawn rotation turns, in radians per second. */
export const ROCK_SPIN_RATE = 1.1;

/** How far ahead of the ship's centre a round or a torpedo leaves, in units. */
export const MUZZLE_OFFSET = SHIP_R * 0.9;

/** How many rejected draws a wave placement makes before it takes its best. */
export const WAVE_PLACEMENT_TRIES = 400;

/** The margin a wave placement keeps beyond the stated minimum, in units. */
export const WAVE_PLACEMENT_MARGIN = 2;
