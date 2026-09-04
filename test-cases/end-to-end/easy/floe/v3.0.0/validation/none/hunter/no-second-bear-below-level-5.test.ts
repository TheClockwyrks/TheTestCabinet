// hunter/no-second-bear-below-level-5 — one bear hunts below level 5.
//
// specs/hunter.md: "A level below `SECOND_BEAR_LEVEL` (`5`) has one slot". So at
// level 4 the hunt has exactly one slot however far the critter has advanced and
// however long the crossing runs: a second bear never joins, and the one on the
// strait is not doubled by a build that counts slots by the level's SPEED, by the
// advance, or by elapsed time.
//
// The critter is posed twelve rows of advance up — twice the six the SECOND slot
// would need at a level that had one — so nothing about the advance is what is
// keeping the hunt to one. The roster is then watched for a minute, which is twice
// the crossing timer level 4 gets, so a build that opened a second slot on any
// schedule at all has had it happen.
//
// The critter stands on the ice band with `bestRow` posed above it: `bestRow` is
// the topmost row a crossing has REACHED, which a critter that came back down
// keeps, and the advance is what the emergence rule reads. So the pose is a legal
// crossing rather than a critter parked on open water.
//
// The reading is the largest roster seen. A minimum of one goes with it, because
// "never more than one" is satisfied by a hunt that never started, and that is not
// what this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ICE_TOP, ROW_NEAR, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { largestRoster } from "./harness";

/** The level read: the one below SECOND_BEAR_LEVEL. */
const LEVEL = 4;

/** Twelve rows of advance, twice what a second slot would ask for. */
const ADVANCED_ROWS = 12;

/** Where the critter stands: solid ice, whatever row it has reached. */
const CRITTER_ROW = ICE_TOP;

/** The game time the roster is watched for, from the item. */
const WATCH_SECONDS = 60;

/**
 * The opening stretch, recorded: past both slots' delays several times over.
 *
 * Only this much of the minute is armed for the recorder. Thirty frames a second
 * of a whole minute is eighteen hundred pictures drawn to keep the three hundred
 * a replay holds, and the stretch a reviewer wants is the one the hunt starts in.
 */
const RECORDED_SECONDS = 5;

/** How often the roster is read: fine enough that no arrival is stepped over. */
const POLL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never holds more than one bear over a minute of level 4", async () => {
  await startCrossing(h, LEVEL);
  await h.debug.setCritterTile(START_COL, CRITTER_ROW);
  await h.debug.setBestRow(ROW_NEAR - ADVANCED_ROWS);
  await h.debug.setBearEmergence(true);

  const opening = await captureReplay(h, "one", () =>
    largestRoster(h, ticksFor(RECORDED_SECONDS), POLL_TICKS),
  );
  const rest = await largestRoster(
    h,
    ticksFor(WATCH_SECONDS - RECORDED_SECONDS),
    POLL_TICKS,
  );
  const largest = Math.max(opening, rest);

  assertGreaterThanOrEqual(
    largest,
    1,
    `bears seen at once over ${WATCH_SECONDS} s of a level ${LEVEL} crossing ` +
      `${ADVANCED_ROWS} rows in`,
  );
  assertEqual(
    largest,
    1,
    `the most bears on the strait at once over ${WATCH_SECONDS} s of level ` +
      `${LEVEL}`,
  );
});
