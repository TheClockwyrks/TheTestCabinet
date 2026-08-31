// bays/fish-interval — the next bonus catch arrives `FISH_INTERVAL` after the
// last one left.
//
// specs/bays.md: "The next appears this long after the previous one leaves —
// `FISH_INTERVAL` (`8` s)."
//
// The measurement starts at the DEPARTURE rather than at the appearance, which is
// what the rule is stated against and what isolates this point from
// `bays/fish-lingers`. A catch is posed with `setFishBay`, whose linger clock
// starts at the call (specs/instrumentation.md); the linger is then run out and
// the exact tick the catch leaves is found by stepping one tick at a time, so the
// interval below is counted from that tick and not from a coarse sample.
//
// The cadence gate goes back on, because the arrival this point times is the
// cadence's own. No bay is filled and nothing else is on the strait, so all four
// remaining bays are open for the draw and `specs/bays.md`'s "where no such bay
// exists, none appears" branch cannot be what is being measured.
//
// The window is the tenth of a second the review item names: nothing may have
// arrived at `FISH_INTERVAL - TOLERANCE`, and something must have by
// `FISH_INTERVAL + TOLERANCE`. At the `TICK_HZ` (`120`) `specs/overview.md` fixes
// that is `12` ticks either side of the `960` the figure is worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { FISH_INTERVAL, FISH_LINGER } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The bay the first catch is posed into. */
const BAY = 1;

/** The tenth of a second the review item allows, in seconds. */
const TOLERANCE = 0.1;

/** How far into the linger the departure is looked for, and the window it is found in. */
const LINGER_EARLY_TICKS = ticksFor(FISH_LINGER - TOLERANCE);
const LINGER_WINDOW_TICKS = ticksFor(2 * TOLERANCE);

/** The interval, less the tolerance: no catch may have arrived yet here. */
const EARLY_TICKS = ticksFor(FISH_INTERVAL - TOLERANCE);

/** The window one must arrive within, from `EARLY_TICKS` to the far tolerance. */
const WINDOW_TICKS = ticksFor(2 * TOLERANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brings the next bonus catch eight seconds after the last one left", async () => {
  await startCrossing(h);
  await h.debug.setFishCadence(true);
  await h.debug.setFishBay(BAY);

  // Run the posed catch's linger out and stop on the very tick it leaves, which
  // is the instant the interval is measured from.
  await h.advance(LINGER_EARLY_TICKS);
  const left = await h.until((s) => s.fishBay === null, {
    maxTicks: LINGER_WINDOW_TICKS,
    poll: 1,
  });
  assertEqual(
    left.hit,
    true,
    `the posed catch gone by ${FISH_LINGER + TOLERANCE} s (specs/bays.md)`,
  );

  // Both ends of the window are READ before either is asserted, so the picture
  // is the one the far end left: the bay the next catch arrived in when the gap
  // was right, and an empty far shore when nothing came at all.
  await h.advance(EARLY_TICKS);
  const early = await h.snapshot();
  const next = await h.until((s) => s.fishBay !== null, {
    maxTicks: WINDOW_TICKS,
    poll: 1,
  });
  await captureStill(h, "fish");

  assertNull(
    early.fishBay,
    `no bonus catch before ${FISH_INTERVAL - TOLERANCE} s of the gap`,
  );
  assertEqual(
    next.hit,
    true,
    `a bonus catch by ${FISH_INTERVAL + TOLERANCE} s of the gap`,
  );
  assertNotNull(next.snapshot.fishBay, "the bay the next bonus catch took");
});
