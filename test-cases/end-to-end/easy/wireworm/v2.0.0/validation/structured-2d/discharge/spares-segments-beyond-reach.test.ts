// discharge/spares-segments-beyond-reach — a segment beyond the reach stands.
//
// specs/discharge.md bounds the fry as tightly as it bounds the chain: a segment
// is destroyed when its tile "lies within `DISCHARGE_RADIUS` (`2`) tiles of the
// tile of any node the discharge detonated", and "A segment further than that from
// every detonated node is untouched and stays on its tile."
//
// So the worm posed here stands three tiles from the one node that detonates —
// one tile past the reach — and it is read on that same tile afterwards. A build
// whose radius is `3`, or whose reach is Euclidean and rounded outward, destroys
// it and the tile answers with no worm at all.
//
// The near side of this boundary is discharge/fries-segments-in-reach, its own
// point: a build that fries the whole board and a build that fries nothing would
// score alike on one paired item.
//
// The worm's own faculties are off. This point is about what the discharge does
// not do to a segment, not about where the worm walks, so a segment that is still
// on its tile is one the discharge left there rather than one that stepped back
// onto it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  wormOn,
  type Harness,
} from "../harness";
import { detonate } from "./detonation";

/** The critical node the bolt is fired into. */
const STRUCK = { c: 12, r: 8 };

/**
 * The lone segment, three columns along the detonation's row: a Chebyshev
 * distance of `3`, one past `DISCHARGE_RADIUS` (`2`), and the only node that
 * detonates is the struck one.
 */
const BEYOND = { c: 15, r: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a worm segment three tiles from the detonation on its tile", async () => {
  startPlaying(h);
  const worm = poseWorm(h, BEYOND.c, BEYOND.r, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "spared");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertDefined(
    wormOn(after, BEYOND.c, BEYOND.r),
    "a worm still holding a segment three tiles from the detonation",
  );
});
