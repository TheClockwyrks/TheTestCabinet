// brightness/graze — swimming into one pellet, for the two points that measure a
// brightness curve off a real eat. CASE-PROVIDED.
//
// Both `brightness/from-eating` and `brightness/holds-decays` open the same way:
// the forager is stood on the first tile of a posed corridor whose remaining tiles
// this check laid a pellet on, and then it swims east into the next one. What it
// measures afterwards differs, so the WAIT lives here and every threshold stays in
// the check that asserts it.
//
// THE EAT IS SWEPT EVERY FRAME. Pellets sit one tile apart and the forager crosses
// a tile in thirty ticks, so a coarser poll can step over two of them and report
// one eat that paid twice.
//
// AND A GRAZE THAT NEVER HAPPENED IS A FAILURE. Both points measure a curve OFF AN
// EAT, so an eat that never came about is the point's own subject failing to
// happen, and there is no curve to grade instead. The budget is a hard ceiling
// stated by the caller, so a build that is merely slow fails here rather than
// being waited for.

import { DIR_KEY, type Harness } from "../harness";
import { fail } from "../assert";
import { FathomSnapshot } from "../surface";

/** How a caller wants the graze waited out. */
export interface GrazeOptions {
  /**
   * The hard ceiling on the swim, in ticks. A build slower than this fails rather
   * than being waited for.
   */
  budget: number;
  /**
   * Ticks run after the eat before the state is read, for a check that reads a
   * DERIVED quantity: a build may raise `G` on the tick the pellet goes and widen
   * what `G` drives at the top of the next step, and both conform. Zero for a
   * check that wants the tick of the eat itself.
   */
  beat?: number;
}

/**
 * Swim into the next pellet along the corridor and hand back the state to measure
 * from, failing the check when no eat came about.
 *
 * `before` is the state the swim starts from; the sweep watches
 * `planktonRemaining` fall below what it reports.
 */
export async function grazeOne(
  h: Harness,
  before: FathomSnapshot,
  options: GrazeOptions,
): Promise<FathomSnapshot> {
  const { budget, beat = 0 } = options;
  h.hold(DIR_KEY.right);
  try {
    const swept = await h.until(
      (s) => s.planktonRemaining < before.planktonRemaining,
      { maxFrames: budget, poll: 1 },
    );
    if (!swept.hit) {
      const moved = Math.hypot(
        swept.snapshot.forager.x - before.forager.x,
        swept.snapshot.forager.y - before.forager.y,
      );
      fail(
        `the forager to travel under the held action and eat the plankton one ` +
          `tile ahead within ${budget} ticks, which is the eat this point ` +
          "measures its curve off",
        `it moved ${moved.toFixed(1)} units and planktonRemaining stayed at ` +
          String(before.planktonRemaining),
      );
    }
    if (beat === 0) return swept.snapshot;
    await h.advance(beat);
    return h.snapshot();
  } finally {
    h.release(DIR_KEY.right);
  }
}
