// hunter/no-emergence-on-near-shore — a critter that has not left the near shore
// is not hunted at all.
//
// specs/hunter.md: a slot fills only when BOTH its conditions hold, and the first
// of them is that the critter has advanced `BEAR_EMERGE_ADVANCE` (3) rows. A
// crossing that has stayed on the near shore has advanced none — `bestRow` is
// `ROW_NEAR`, so `ROW_NEAR - bestRow` is `0` — so the delay running out over and
// over changes nothing and no bear ever appears. This is the "only" in the rule,
// and it is what separates a build that reads both conditions from one that reads
// the clock alone.
//
// Emergence is on, and it is the only gate opened: with it shut the roster would
// stay empty for a reason that has nothing to do with the rule.
//
// THE HALF MINUTE IS WATCHED IN TWO STRETCHES, and only the first is recorded.
// Thirty seconds of this game is three thousand six hundred drawn frames, and a
// recording of all of them would be a file nobody can serve to a reviewer; the
// opening stretch is the one that shows the near shore standing quiet while the
// delay a build might have read alone runs out several times over.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_EMERGE_DELAY, ROW_NEAR } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { largestRoster } from "./harness";

/** The game time the near shore is watched for, from the item. */
const WATCH_SECONDS = 30;

/**
 * The opening stretch, recorded: five times `BEAR_EMERGE_DELAY`.
 *
 * Long enough that a build reading the delay alone has emerged inside the
 * recording, so the evidence shows the moment the item is really about.
 */
const RECORDED_SECONDS = 5 * BEAR_EMERGE_DELAY;

/**
 * How often the roster is read over that half minute.
 *
 * A quarter of a second: fine enough that a bear which appeared and was gone
 * again could not slip between two reads — nothing takes a bear off the strait
 * here, there being no traffic and no crossing to end — and coarse enough that
 * thirty seconds costs a hundred and twenty reads rather than three thousand six
 * hundred.
 */
const POLL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("never emerges a bear behind a critter still on the near shore", async () => {
  startCrossing(h);
  h.debug.setBearEmergence(true);

  const opening = await captureReplay(h, "wait", () =>
    largestRoster(h, ticksFor(RECORDED_SECONDS), POLL_TICKS),
  );
  const rest = await largestRoster(
    h,
    ticksFor(WATCH_SECONDS - RECORDED_SECONDS),
    POLL_TICKS,
  );

  // The scenario this check needs, read off the game itself: the run's own
  // emergence really was running, and the critter really did stay where a fresh
  // crossing put it, so the advance the rule reads was nil throughout. Without the
  // first of those an empty roster would say nothing at all.
  const settled = h.snapshot();
  assertEqual(
    settled.bearEmergence,
    true,
    "the run's own emergence of bears, opened for this check " +
      "(specs/instrumentation.md)",
  );
  assertEqual(settled.critter.bestRow, ROW_NEAR, "bestRow");
  assertEqual(
    Math.max(opening, rest),
    0,
    `the most bears on the strait at once over ${WATCH_SECONDS} s of a near ` +
      `shore`,
  );
});
