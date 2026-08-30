// channel/merge-single-segment — once two segments have met they ride as one, so
// the core that was catching up takes the feed speed.
//
// THE SPEC LINE. `specs/channel.md`, "Merging": "the arc positions across the
// join differ by exactly `SPACING` and the two segments become one." What that
// costs the trailing core is the same file's advance table: the lead segment
// rides at "the effective feed speed" and "Every other segment" at 180 units/s,
// so a core that has joined the lead segment rides at the feed speed from then
// on. `specs/instrumentation.md` has the snapshot report the join both ways —
// `segments` is "The segments, head first, entry 0 the lead segment" and
// `train[].segment` is derived from "The spacing between consecutive cores" — so
// the merged train reads as one segment with every core in it.
//
// THE DRIVE. `channel/merge-clamp`'s arrangement carried on: a lead core at 2000
// and a trailing core a hundred units back, ninety ticks to close and clamp, and
// then a further sixty ticks — one second — over which the trailing core's gain
// is read. With the pressure at 0 and no machinery, level 1's feed speed of 22
// units/s is the effective one.
//
// WHY BOTH READINGS. A build that never merges but still honours the clamp
// leaves the trailing core in exactly the same place — pinned one spacing behind
// a lead riding at the feed speed — so the arc gain alone cannot tell the two
// designs apart. The segment count is what does: the specification says the two
// BECOME ONE, and the snapshot is required to report that. So this reads the
// gain (the requirement's consequence, which fails a build that keeps racing the
// trailing core at the catch-up rate) and the join (the requirement itself).
//
// THE TOLERANCES. The gain is a speed read over sixty ticks, so +/- 2% of 22
// units/s, the case's standing tolerance for a speed over at least thirty ticks
// — loose enough for any build that integrates the second differently and far
// too tight for the catch-up rate, which is eight times larger. The segment
// count and each core's segment index are counts, and a count is exact.
//
// A FIGURE NOT ENCODED. The manifest's note for this point expects the trailing
// core to gain "22 units of arc rather than 120". 22 is the specification's
// (level 1's feed speed over one second); 120 follows from nothing in the specs —
// sixty ticks at the catch-up rate of 180 units/s is 180 units, not 120 — so the
// alternative this check rules out is the spec-derived one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNearFraction } from "../assert";
import { SPEED_TOL_FRACTION, levelSpec } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  speedOverTicks,
  tail,
  type Harness,
} from "../harness";

/** The lead core. */
const LEAD_S = 2000;

/** The trailing core, a hundred units back: its own segment, and closing. */
const TRAIL_S = 1900;

/** Ticks that carry the close and the clamp, before the reading begins. */
const MERGE_TICKS = 90;

/** One second of simulated time, over which the joined core's gain is read. */
const TICKS = 60;

/** The level this is read on, and the feed speed its row fixes. */
const LEVEL = 1;
const FEED = levelSpec(LEVEL).feed;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rides a merged pair as one segment, at the feed speed", async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    quotaRemaining: 0,
    cores: [
      [LEAD_S, "halide", null],
      [TRAIL_S, "sulfur", null],
    ],
  });
  const merged = await h.step(MERGE_TICKS);
  const before = tail(merged).s;

  const after = await captureReplay(h, "joined", () => h.step(TICKS));

  assertEqual(coreCount(after), 2, "the cores on the channel after the drive");
  assertNearFraction(
    speedOverTicks(tail(after).s - before, TICKS),
    FEED,
    SPEED_TOL_FRACTION,
    "the joined core's speed, in units/s",
  );
  assertEqual(
    after.segments.length,
    1,
    "the segments the merged train stands in",
  );
  for (const [index, core] of after.train.entries()) {
    assertEqual(
      core.segment,
      0,
      `the segment core ${index} of the merged train belongs to`,
    );
  }
});
