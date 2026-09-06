// Meltdown — surge/vent-drawn-at-random: the release's vent draw varies: a
// short run of draws lands on both vents.
//
// THE RULE. `specs/waves.md`: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely." The same file gives the draw a
// reading of its own: the debug surface "performs one draw on its own through
// `drawVent`", which `specs/instrumentation.md` defines as "one vent draw exactly
// as the release performs it", returning `"left"` or `"top"` and doing nothing
// else.
//
// WHAT IS READ. Forty draws through `drawVent`. Every one must be a vent, and
// across the forty both vents must appear: a build that sends every unit through
// one vent is a completely different game, with one corridor to defend rather
// than two, and over forty draws at "equally likely" a draw that ever chose the
// other vent would have to be extraordinarily unlucky to hide it, one run in five
// hundred thousand million. Whether the two come up in the stated proportion is
// `surge/vents-equally-likely`'s item, decided on a larger run of the same draw.
//
// NOTHING IS RELEASED. The draws touch no unit and no wave: the floor is the
// quiet one `startRun` leaves, and the reading is the draws alone. That the
// release honours a posed vent, and returns to this draw when the pose is
// cleared, are `instrumentation/spawn-vent-pose` and
// `instrumentation/spawn-vent-pose-cleared`.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawVents,
  startRun,
  type Harness,
} from "../harness";

/** The two answers the specification allows. */
const VENTS = ["left", "top"] as const;

/**
 * How many draws the reading is taken over: forty.
 *
 * Enough that a fair draw shows both vents with all but a thousand-millionth of
 * certainty, and few enough that the check costs nothing. A build that chose
 * one vent for every draw is what the count is sized to catch.
 */
const DRAWS = 40;

/** The fewest distinct vents the draws must land on: both of them. */
const MIN_DISTINCT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands on both vents across a short run of draws", async () => {
  await startRun(h);
  const drawn = await drawVents(h, DRAWS);
  await h.advance(1);
  await captureStill(h, "vents");

  for (const [index, vent] of drawn.entries()) {
    assertContains(
      VENTS,
      vent,
      `draw ${index + 1}: the vent drawVent returned`,
    );
  }
  assertGreaterThanOrEqual(
    new Set(drawn).size,
    MIN_DISTINCT,
    `the distinct vents among ${DRAWS} draws (specs/waves.md: each unit's ` +
      "vent is drawn at random, the two vents equally likely)",
  );
});
