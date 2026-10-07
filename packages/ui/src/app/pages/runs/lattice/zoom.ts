// How much of a factory the player shows at once.
//
// A Lattice board is drawn at its native size — one 32px sprite per cell — and the
// scored boards are big: the medium factory is 48x32 cells (1536x1024 pixels) and the
// large one 72x40 (2304x1280), before the 2x the player used to magnify every board
// to. Neither comes near fitting a browser viewport, so watching one meant scrolling
// around a factory that could never be seen whole. These are the two answers to that:
// a fit scale the player follows by default, and a ladder the zoom controls step
// through when a viewer wants to look closer instead.
//
// This module is pure arithmetic over sizes, kept out of the player so the rules for
// "what fits" and "what is one step in" can be stated and tested on their own.

/** A pixel size — a board's native extent, or the stage it has to fit into. */
export interface Extent {
  width: number;
  height: number;
}

/**
 * The zoom ladder the player's −/+ controls step through, as a multiple of the
 * board's native size.
 *
 * It reaches well below 1x on purpose: seeing all of the large factory at once on a
 * laptop means shrinking it, and reading one assembler's animation means magnifying
 * past 1x. Both ends are reachable in a few clicks from anywhere in between.
 */
export const ZOOM_STEPS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** The ladder's ends, which also bound the fit scale below. */
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/**
 * Fit scales a board to the stage but never magnifies past this. The small factory is
 * 24x12 cells — 768x384 pixels — and would otherwise be blown up to fill a wide
 * monitor, where a cell is a fistful of screen; 2x is the size the player showed every
 * board at before it could zoom at all, so the small factory still looks as it did.
 */
export const MAX_FIT_ZOOM = 2;

/**
 * The largest zoom at which a `board` fits entirely inside a `stage` — what the Fit
 * control follows, recomputed as the window resizes.
 *
 * Returns 1x when either extent is unknown or degenerate (before the engine posts its
 * board, or in an environment that reports no layout at all), so a canvas is never
 * sized off a zero and collapsed to nothing.
 */
export function fitZoom(board: Extent | null, stage: Extent | null): number {
  if (!board || !stage) return 1;
  if (board.width <= 0 || board.height <= 0) return 1;
  if (stage.width <= 0 || stage.height <= 0) return 1;
  const raw = Math.min(stage.width / board.width, stage.height / board.height);
  return Math.min(Math.max(raw, MIN_ZOOM), MAX_FIT_ZOOM);
}

/**
 * The next rung above (`1`) or below (`-1`) `current`, which is usually a fit scale
 * sitting *between* two rungs rather than on one — so stepping means "the next rung
 * past here", not "the neighbour of my rung". Saturates at the ladder's ends.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  // Rungs are a hair apart in floating point after a division; without a tolerance,
  // stepping up from a scale that IS a rung could return that same rung.
  const epsilon = 1e-6;
  if (direction === 1) {
    return ZOOM_STEPS.find((zoom) => zoom > current + epsilon) ?? MAX_ZOOM;
  }
  const below = ZOOM_STEPS.filter((zoom) => zoom < current - epsilon);
  return below[below.length - 1] ?? MIN_ZOOM;
}
