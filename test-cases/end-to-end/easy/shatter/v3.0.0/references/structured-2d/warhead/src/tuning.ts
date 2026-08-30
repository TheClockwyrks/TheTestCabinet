// Shatter — the figures the specification leaves to the build.
//
// `src/constants.ts` holds every figure the specification fixes and is the
// authority on all of them. What is left over is here, in one place, so no
// number in the game is written inline: how far the nose sits ahead of the
// ship's centre (the specification bounds it at `SHIP_R` and leaves the rest),
// how the saucer's own steering keeps it clear of the star's core, how a
// recycled rock is aimed back into the field, and how long an awarded ship is
// announced for.

/** How far ahead of the ship's centre a round leaves, inside `SHIP_R`. */
export const NOSE_OFFSET = 12.6;

/**
 * The standoff the saucer's steering keeps from the star's centre.
 *
 * `specs/saucer.md` requires only that the saucer's circle never overlaps the
 * core — that its centre is never closer than `CORE_R + SAUCER_R` (`48`) — and
 * leaves how far outside that it steers to the build. This is that choice, wide
 * enough that a reroll of the weave taken on the wrong tick cannot eat it.
 */
export const AVOID_DIST = 96;

/** How far along its current course the saucer looks for the core, in seconds. */
export const AVOID_LOOKAHEAD = 1.6;

/** How far inside an edge a recycled rock re-enters the field. */
export const RECYCLE_MARGIN = 1;

/** The widest angle either side of straight inward a recycled rock enters on. */
export const RECYCLE_SPREAD = Math.PI / 3;

/** The fastest drawn rotation a rock carries, in radians per second. */
export const SPIN_RATE_MAX = 0.8;

/** How many placements a wave tries before taking the best it has found. */
export const WAVE_PLACE_TRIES = 200;

/** How long an awarded ship is announced on the field, in seconds. */
export const EXTRA_FLASH_TIME = 1.6;

/** The most ticks one frame is allowed to run before the rest is dropped. */
export const MAX_TICKS_PER_FRAME = 30;

/** The slack the tick accumulator allows, so a delta of one tick runs one. */
export const TICK_EPSILON = 1e-9;
