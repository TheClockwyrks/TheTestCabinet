// progression/death-pause — a lost life holds the crossing for nine tenths of a
// second before a critter is back on the strait.
//
// specs/progression.md fixes the hold in its phase table — `dying`, "Holding after
// a life was lost", `DEATH_PAUSE` (`0.9` s) — and fixes what expiring it leads to:
// "`lives` above `0`: a fresh crossing begins".
//
// THIS POINT ASSERTS THE DURATION ALONE, and it poses the cheapest death to reach
// it: a critter stood on the emptied water band, which falls in on the very next
// tick (specs/water.md). That each of the five deaths reaches `dying` at all is each
// of their own items' requirement — `catch-costs-life` and its four neighbours — so
// nothing here depends on which death was taken.
//
// TWO READINGS, ONE EITHER SIDE, WHICH IS WHAT MAKES IT A DURATION. A single reading
// past the end would pass on a build that respawned instantly, and a single reading
// before it would pass on a build that never respawned at all. `EARLY` is a tenth
// of a second short of the hold, where a build that has held it is still `dying`;
// `LATE` is a tenth past it, where a build that has held it has a critter back on
// the strait. The tenth of a second is the tolerance this point allows around the
// specification's `0.9`, and it is twelve whole ticks at the `TICK_HZ` (`120`)
// specs/overview.md fixes, so neither reading turns on rounding.
//
// The two readings are the same requirement stated once with a tolerance, not two
// requirements: a build whose hold is `0.5` s fails the first, one whose hold is
// `1.5` s fails the second, and each failure names which way the build was wrong.
//
// `startCrossing` leaves `START_LIVES` (`3`) in hand, so the hold expires into a
// fresh crossing rather than into the game over `progression/game-over-at-zero` is
// about.

import { afterEach, beforeEach, it } from "vitest";
import { DEATH_PAUSE, START_COL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The water-band tile the death is taken on. */
const COL = START_COL;
const ROW = 5;

/** The one frame the fall needs. */
const FALL_FRAMES = 1;

/**
 * How far either side of `DEATH_PAUSE` the two readings are taken, in seconds.
 *
 * A tenth of a second, which is the tolerance this point allows around the
 * specification's `0.9` s and twelve whole ticks at the `TICK_HZ` (`120`)
 * specs/overview.md fixes — so neither reading can be decided by the rounding of a
 * hundred and eight subtractions of a hundred-and-twentieth.
 */
const TOLERANCE = 0.1;

/** The two readings, in frames after the frame the life was lost on. */
const EARLY = ticksFor(DEATH_PAUSE - TOLERANCE);
const LATE = ticksFor(DEATH_PAUSE + TOLERANCE) - EARLY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the crossing at dying for nine tenths of a second, then respawns", async () => {
  startCrossing(h);
  h.debug.setCritterTile(COL, ROW);

  const { held, resumed } = await captureReplay(h, "pause", async () => {
    await h.advance(FALL_FRAMES);
    const dying = h.snapshot();
    assertEqual(dying.phase, "dying", "a life lost on the emptied water band");

    await h.advance(EARLY);
    const stillHeld = h.snapshot();
    await h.advance(LATE);
    return { held: stillHeld, resumed: h.snapshot() };
  });

  assertEqual(
    held.phase,
    "dying",
    `still holding a tenth of a second short of DEATH_PAUSE (${DEATH_PAUSE} s)`,
  );
  assertEqual(
    resumed.phase,
    "crossing",
    `crossing again a tenth of a second past DEATH_PAUSE (${DEATH_PAUSE} s)`,
  );
  assertEqual(
    resumed.critter.present,
    true,
    "a critter back on the strait once the hold expired",
  );
});
