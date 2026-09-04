// Arc Foundry — sampling an overlay's own pixels. CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// THE PROBLEM. `specs/hud.md` requires the recipe book to draw each ingredient in
// one of three states "told apart at a glance", and the only reading that reports
// where anything on an overlay was drawn is `statusControls`, which reports the
// bar's five toggles and nothing inside either overlay. So an ingredient's state
// can only be decided from PIXELS, and the pixels have to be the book's rather
// than the yard's: every pose that makes an ingredient owned also stands a
// structure on the yard, and a check that sampled the whole stage would read that
// structure's own sprite as the ingredient changing state.
//
// THE MASK. So the book's own points are found rather than assumed, by a double
// difference over the poses a check is about to compare:
//
//   * a point is the book's if opening the overlay moves it, over a yard that did
//     not change while it opened;
//   * a point is NOT the book's if it moves between two poses with the overlay
//     CLOSED, because then what moved it is the yard underneath — which also
//     removes any point a translucent overlay lets the yard show through.
//
// What is left is the region the book paints over ground the poses leave alone,
// and a comparison restricted to it reads the book and only the book. A mask that
// comes back empty is itself a verdict: the overlay drew nothing.

import { DISTINCT, lattice, rgbDistance, sample } from "./reading";
import { STAGE_H, STAGE_W } from "../constants";
import type { Harness } from "../harness";

type Pixel = [number, number, number, number];

/** One arrangement of the yard the book is to be read over. */
export interface Pose {
  /** What it is, for a failure that has to name which pose it read. */
  name: string;
  /** Arrange the yard. The overlay is opened and closed around it. */
  arrange: (h: Harness) => Promise<void>;
}

/** What a sampling read: the book's own points, and each pose's colours there. */
export interface BookReading {
  /** How many stage points the book was found to paint. */
  points: number;
  /** One pose's colours at those points, in the order the poses were given. */
  open: Pixel[][];
}

/** How finely the stage is sampled. Small enough to land inside an ingredient chip. */
const STEP = 6;

/**
 * Read the recipe book over each pose in turn, at the points the book owns.
 *
 * Each pose is arranged once and sampled twice, with the overlay closed and then
 * open, so the mask above can be built from the same samples the comparison uses.
 */
export async function readBook(
  h: Harness,
  overlay: "combos" | "damage",
  poses: readonly Pose[],
): Promise<BookReading> {
  const points = lattice({ x: 0, y: 0, w: STAGE_W, h: STAGE_H }, STEP);
  const closed: Pixel[][] = [];
  const open: Pixel[][] = [];
  for (const pose of poses) {
    await h.debug.setOverlay(overlay, false);
    await pose.arrange(h);
    closed.push(await sample(h, points));
    await h.debug.setOverlay(overlay, true);
    open.push(await sample(h, points));
  }

  const mask: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (rgbDistance(closed[0]![i]!, open[0]![i]!) <= DISTINCT) continue;
    let steady = true;
    for (let p = 1; p < closed.length; p += 1) {
      if (rgbDistance(closed[0]![i]!, closed[p]![i]!) > DISTINCT)
        steady = false;
    }
    if (steady) mask.push(i);
  }

  return {
    points: mask.length,
    open: open.map((pose) => mask.map((i) => pose[i]!)),
  };
}

/** How many of the book's points read differently between two poses. */
export function movedPoints(a: readonly Pixel[], b: readonly Pixel[]): number {
  let moved = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (rgbDistance(a[i]!, b[i]!) > DISTINCT) moved += 1;
  }
  return moved;
}
