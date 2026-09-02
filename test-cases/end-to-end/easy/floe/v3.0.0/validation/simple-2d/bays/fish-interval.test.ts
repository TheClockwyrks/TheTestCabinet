// bays/fish-interval — the next bonus catch arrives `FISH_INTERVAL` after the
// last one left.
//
// specs/bays.md: "The next appears this long after the previous one leaves —
// `FISH_INTERVAL` (`8` s)."
//
// The measurement starts at the DEPARTURE rather than at the appearance, which is
// what the rule is stated against and what isolates this point from
// `bays/fish-lingers`. A catch is posed with `setFishBay`, whose linger clock
// starts at the call (specs/instrumentation.md), and the exact frame it leaves is
// then found by stepping one frame at a time from the pose, so the interval below
// is counted from that frame and not from a coarse sample.
//
// THE DEPARTURE IS SWEPT FOR RATHER THAN ASSUMED, over half again `FISH_LINGER`.
// Skipping straight to the linger's far side would peg the origin to the figure
// `bays/fish-lingers` decides instead of to the departure that actually happened,
// and a build whose catch left a second early would fail here as well as there —
// two grades for one defect. Swept, the origin is wherever the catch really left,
// and this point stays about the gap that follows it.
//
// The cadence gate goes back on, because the arrival this point times is the
// cadence's own. No bay is filled and nothing else is on the strait, so all four
// remaining bays are open for the draw and `specs/bays.md`'s "where no such bay
// exists, none appears" branch cannot be what is being measured.
//
// The window is the tenth of a second the review item names: nothing may have
// arrived at `FISH_INTERVAL - TOLERANCE`, and something must have by
// `FISH_INTERVAL + TOLERANCE`. At the `TICK_HZ` (`120`) `specs/overview.md` fixes
// that is `12` frames either side of the `960` the figure is worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { FISH_INTERVAL, FISH_LINGER, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The bay the first catch is posed into. */
const BAY = 1;

/** The tenth of a second the review item allows, as whole frames: `12` at `120` Hz. */
const TOLERANCE_FRAMES = Math.round(0.1 * TICK_HZ);

/**
 * How far the posed catch's departure is swept for: half again `FISH_LINGER`.
 *
 * Generous on purpose. What the linger is worth is `bays/fish-lingers`'s
 * requirement, so this point accepts a departure wherever it falls and measures
 * the gap from there.
 */
const LINGER_WAIT_FRAMES = ticksFor(FISH_LINGER * 1.5);

/** The interval, less the tolerance: no catch may have arrived yet here. */
const EARLY_FRAMES = Math.round(FISH_INTERVAL * TICK_HZ) - TOLERANCE_FRAMES;

/** The window one must arrive within, from `EARLY_FRAMES` to the far tolerance. */
const WINDOW_FRAMES = 2 * TOLERANCE_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("brings the next bonus catch eight seconds after the last one left", async () => {
  startCrossing(h);
  h.debug.setFishCadence(true);
  h.debug.setFishBay(BAY);

  // Stop on the very frame the posed catch leaves, which is the instant the
  // interval is measured from.
  const left = await h.until((s) => s.fishBay === null, {
    maxFrames: LINGER_WAIT_FRAMES,
    poll: 1,
  });
  assertEqual(
    left.hit,
    true,
    `the posed catch gone by ${seconds(LINGER_WAIT_FRAMES)} s (specs/bays.md)`,
  );

  // Both ends of the window are READ before either is asserted, so the picture
  // is the one the far end left: the bay the next catch arrived in when the gap
  // was right, and an empty far shore when nothing came at all.
  await h.advance(EARLY_FRAMES);
  const early = h.snapshot();
  const next = await h.until((s) => s.fishBay !== null, {
    maxFrames: WINDOW_FRAMES,
    poll: 1,
  });
  captureStill(h, "fish");

  assertNull(
    early.fishBay,
    `no bonus catch before ${seconds(EARLY_FRAMES)} s of the gap`,
  );
  assertEqual(
    next.hit,
    true,
    `a bonus catch by ${seconds(EARLY_FRAMES + WINDOW_FRAMES)} s of the gap`,
  );
  assertNotNull(next.snapshot.fishBay, "the bay the next bonus catch took");
});
