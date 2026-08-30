// discharge/fries-segments-in-reach — a discharge destroys the segments in its
// reach.
//
// specs/discharge.md, on what a discharge does to the worm: "Every worm segment
// whose tile lies within `DISCHARGE_RADIUS` (`2`) tiles of the tile of any node
// the discharge detonated, measured the same Chebyshev way, is destroyed."
//
// The worm posed here has its head exactly `2` tiles from the detonation, which
// is the far edge of that reach and the hardest tile for a build to get right: a
// build whose test is strict where the spec's is inclusive spares it. The tile is
// read for a segment afterwards, and on a correct build it holds none.
//
// The worm carries a second segment one tile further out, at `3`, which the
// discharge does not reach. It is not what this point reads — whether it survives
// is discharge/spares-segments-beyond-reach — but it keeps the worm on the board
// through the fry, so the point is decided by the fry rule alone and not by the
// level-clear rule that a board losing its last segment would run into
// (specs/progression.md).
//
// The worm's own faculties are off. This point is about what a discharge does to a
// segment, not about where the worm walks, so it is posed holding its tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertUndefined } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWormPath,
  startPlaying,
  wormOn,
  type Harness,
} from "../harness";
import { detonate } from "./detonation";

/** The critical node the bolt is fired into. */
const STRUCK = { c: 12, r: 8 };

/**
 * The segment the discharge has to destroy: two columns along the detonation's
 * row, a Chebyshev distance of exactly `DISCHARGE_RADIUS` (`2`).
 */
const IN_REACH = { c: 14, r: 8 };

/**
 * The segment behind it, three tiles from the detonation and so out of reach. It
 * is what keeps the worm on the board; nothing here reads it.
 */
const BEHIND = { c: 15, r: 8 };

/** Heading left, so the body trails to the right of the head, where it is posed. */
const HEADING = -1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a worm segment two tiles from the detonation", async () => {
  startPlaying(h);
  const worm = poseWormPath(h, [IN_REACH, BEHIND], HEADING);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "fried");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertUndefined(
    wormOn(after, IN_REACH.c, IN_REACH.r),
    "a worm still holding a segment two tiles from the detonation",
  );
});
