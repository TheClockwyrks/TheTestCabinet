// brightness/graze — swimming into one pellet, for the two points that measure a
// brightness curve off a real eat. CASE-PROVIDED.
//
// Both `brightness/from-eating` and `brightness/holds-decays` open the same way:
// the forager is stood on a posed corridor with a sealed larder, the pellet
// underfoot is settled off camera, and then it swims east into the next one. What
// it measures afterwards differs, so the WAIT lives here and every threshold stays
// in the check that asserts it.
//
// THE EAT IS SWEPT EVERY FRAME. Pellets sit one tile apart and the forager crosses
// a tile in thirty ticks, so a coarser poll can step over two of them and report
// one eat that paid twice.
//
// AND A GRAZE THAT NEVER HAPPENED IS A PRECONDITION, NOT A VERDICT. Whether the
// forager swims is `controls/*` and `maze-movement/*`'s to decide, and whether it
// eats what it swims over is `scoring/plankton`'s. A build that fails either has
// those items to fail; a curve measured off an eat that never came about says
// nothing about the hold, the decay, or what a pellet is worth.

import { DIR_KEY, type Harness } from "../harness";
import { requireSwim, unmetPrecondition } from "../scene";
import type { FathomSnapshot } from "../surface";

/** How a caller wants the graze waited out. */
export interface GrazeOptions {
  /**
   * The hard ceiling on the swim, in ticks. A build slower than this is stood
   * down rather than waited for.
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
 * from, standing the check down when no eat came about.
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
      requireSwim(
        before.forager,
        swept.snapshot.forager,
        "reach the plankton on the next tile",
      );
      unmetPrecondition(
        `the forager travelled without reaching the plankton one tile ahead ` +
          `within ${budget} ticks, so there was no eat to measure; whether the ` +
          `forager eats what it swims over is scoring/plankton's verdict, not ` +
          `this one's`,
      );
    }
    if (beat === 0) return swept.snapshot;
    await h.advance(beat);
    return h.snapshot();
  } finally {
    h.release(DIR_KEY.right);
  }
}
