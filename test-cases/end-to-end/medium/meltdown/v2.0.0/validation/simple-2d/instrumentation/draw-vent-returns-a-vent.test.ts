// Meltdown — instrumentation/draw-vent-returns-a-vent: `drawVent` answers with
// one of the two vents.
//
// specs/instrumentation.md: "`drawVent()` is a reading that performs one vent
// draw exactly as the release performs it, the two vents equally likely, and
// returns the vent it drew, `"left"` or `"top"`."
//
// THE SHAPE OF THE ANSWER IS WHAT THIS ITEM DECIDES. A run of draws is made and
// every one must be a vent name: a build returning `undefined`, a boolean, an
// index, or the whole state fails on the first answer that is not one of the
// two. Whether the draw varies is `surge/vent-drawn-at-random`'s item, and
// whether it leaves the game alone is `draw-vent-changes-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  captureStill,
  createHarness,
  drawVents,
  startRun,
  type Harness,
} from "../harness";

/** How many draws are read. */
const DRAWS = 200;

/** The two answers the specification allows. */
const VENTS = ["left", "top"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns left or top on every draw", async () => {
  startRun(h);
  const drawn = drawVents(h, DRAWS);
  await h.advance(1);
  captureStill(h, "drawn");

  for (const [index, vent] of drawn.entries()) {
    assertContains(
      VENTS,
      vent,
      `draw ${index + 1} of ${DRAWS}: the vent drawVent returned`,
    );
  }
});
