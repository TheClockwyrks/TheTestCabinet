// progression/drown-costs-life — standing on open water costs the run exactly one
// life and puts the crossing into its dying hold.
//
// specs/progression.md lists the fall among the five things that cost a life, and
// fixes what every one of them costs: "On the tick a life is lost: `lives` drops by
// exactly one, `phase` becomes `dying`". specs/water.md fixes the fall itself: "The
// critter falls in on any tick on which its footing is `water`."
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. What makes a water tile's footing
// `water` rather than `floe` is `water/open-water-drowns` and
// `water/floe-is-footing`; this point is one of the five that ask whether the RUN
// answers a death, and it is the fall's own.
//
// THE SCENARIO IS THE EMPTIEST ONE THE GAME HAS. `startCrossing` has already
// emptied the floe roster, so every tile of the water band is open water and the
// critter has only to be stood on one — a single pose, one tick, and the reading.
// Nothing is added to the strait at all, so nothing but the water can be what took
// the life, and the empty roster is read back before the tick runs.
//
// The delta is read rather than the absolute, so a build that mis-posed the counter
// fails the point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The water-band tile the critter is stood on. Mid-band, mid-strait. */
const COL = START_COL;
const ROW = 5;

/** The one tick a fall needs, and the ticks of the hold kept as evidence. */
const FALL_TICKS = 1;
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life and starts the dying hold when the critter stands on open water", async () => {
  startCrossing(h);
  h.debug.setCritterTile(COL, ROW);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the fall");
  assertEqual(
    before.critter.row,
    ROW,
    "the critter on a water-band row (specs/strait.md)",
  );
  assertLength(
    before.floes,
    0,
    "an empty water band, so the tile below the critter is open water",
  );

  const after = await captureReplay(h, "death", async () => {
    await h.advance(FALL_TICKS);
    const drowned = h.snapshot();
    await h.advance(AFTER_TICKS);
    return drowned;
  });

  assertEqual(
    before.lives - after.lives,
    1,
    "the one life a fall costs (specs/progression.md)",
  );
  assertEqual(after.phase, "dying", "the hold a lost life starts");
});
