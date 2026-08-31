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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ROW_NEAR } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The game time the near shore is watched for, from the item. */
const WATCH_SECONDS = 30;

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

afterEach(async () => {
  await h.dispose();
});

it("never emerges a bear behind a critter still on the near shore", async () => {
  await startCrossing(h);
  await h.debug.setBearEmergence(true);

  const sighting = await captureReplay(h, "wait", () =>
    h.until((snapshot) => snapshot.bears.length > 0, {
      maxTicks: ticksFor(WATCH_SECONDS),
      poll: POLL_TICKS,
    }),
  );

  // The scenario this check needs, read off the game itself: the run's own
  // emergence really was running, and the critter really did stay where a fresh
  // crossing put it, so the advance the rule reads was nil throughout. Without the
  // first of those an empty roster would say nothing at all.
  assertEqual(
    sighting.snapshot.bearEmergence,
    true,
    "the run's own emergence of bears, opened for this check " +
      "(specs/instrumentation.md)",
  );
  assertEqual(sighting.snapshot.critter.bestRow, ROW_NEAR, "bestRow");
  assertLength(
    sighting.snapshot.bears,
    0,
    `the hunt over ${WATCH_SECONDS} s of a near shore`,
  );
});
