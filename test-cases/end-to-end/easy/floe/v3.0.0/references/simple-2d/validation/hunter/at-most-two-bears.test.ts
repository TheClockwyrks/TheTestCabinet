// hunter/at-most-two-bears — never more than two bears hunt.
//
// specs/hunter.md: "a level from `SECOND_BEAR_LEVEL` up has `MAX_BEARS` (`2`), so
// at most two bears ever hunt at once." The hunt has SLOTS, and the slots are the
// ceiling: a bear leaving frees the slot it filled and the refill takes that slot
// rather than adding one, so a minute of a level where both slots keep filling
// never puts a third on the strait.
//
// LEVEL 8 IS THE READING, being the furthest up the run goes and so the level a
// build that scales the hunt with the level rather than stepping it once at
// `SECOND_BEAR_LEVEL` reads highest at. The critter is posed twelve rows of
// advance up, so both slots' advance conditions are met throughout and nothing
// about the advance is what is keeping the count down. The roster is then watched
// for a minute, which is nearly four times the crossing timer level 8 gets.
//
// The reading is the largest roster seen. A minimum of one goes with it, because
// "never more than two" is satisfied by a hunt that never started.
//
// THE MINUTE IS WATCHED IN TWO STRETCHES, and only the first is recorded, for the
// reason `no-second-bear-below-level-5` gives.

import { afterEach, beforeEach, it } from "vitest";
import {
  ICE_TOP,
  MAX_BEARS,
  ROW_NEAR,
  START_COL,
  TOTAL_LEVELS,
} from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { largestRoster } from "./harness";

/** The level read: the last of the run. */
const LEVEL = TOTAL_LEVELS;

/** Twelve rows of advance, twice what the second slot asks for. */
const ADVANCED_ROWS = 12;

/** Where the critter stands: solid ice, whatever row it has reached. */
const CRITTER_ROW = ICE_TOP;

/** The game time the roster is watched for, from the item. */
const WATCH_SECONDS = 60;

/** The opening stretch, recorded: past both slots' delays several times over. */
const RECORDED_SECONDS = 5;

/** How often the roster is read: fine enough that no arrival is stepped over. */
const POLL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never holds more than MAX_BEARS bears over a minute of level 8", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(START_COL, CRITTER_ROW);
  h.debug.setBestRow(ROW_NEAR - ADVANCED_ROWS);
  h.debug.setBearEmergence(true);

  const opening = await captureReplay(h, "two", () =>
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
  assertLessThanOrEqual(
    largest,
    MAX_BEARS,
    `the most bears on the strait at once over ${WATCH_SECONDS} s of level ` +
      `${LEVEL}`,
  );
});
