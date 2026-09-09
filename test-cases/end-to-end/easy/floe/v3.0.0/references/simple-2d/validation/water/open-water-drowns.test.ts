// water/open-water-drowns — a critter standing where no floe covers it falls in
// and loses a life.
//
// specs/strait.md derives the footing: on a row of the water band it is `floe`
// while a floe of that row covers its center and `water` otherwise.
// specs/water.md fixes the cost: "Every tile of the water band is deep water ...
// The critter falls in on any tick on which its footing is `water`. It loses a
// life", and specs/progression.md fixes what a lost life does — `lives` drops by
// exactly one and `phase` becomes `dying`.
//
// THE ROW CARRIES A FLOE THAT DOES NOT REACH THE CRITTER. That is the pose that
// makes this decide the covering rule rather than an emptiness: a build whose
// footing asks only whether the ROW has any floes on it reads `floe` here and
// fails, where an empty row would have let it pass. The floe is parked at a lane
// speed of `0` (`poseLane`), so it cannot drift over the critter while the check
// is reading, and it is twelve columns away, which no tick of a stopped lane
// closes.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO. `startCrossing` clears both rosters and
// shuts the four world gates, so the life this loses cannot have come from a
// bear, from a vehicle, from the crossing timer or from anything else that costs
// one (specs/progression.md). The critter is POSED onto the row rather than
// hopped there, because the hop is specs/hopping.md's requirement and not this
// one.
//
// THE WINDOW IS TWO TICKS. The rule is "any tick on which its footing is
// `water`", and the critter's footing is `water` from the moment it is posed, so
// the very first tick must take the life; the second tick of slack is for a
// build that derives its footing after moving its lanes rather than before, and
// nothing beyond it is allowed.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The drowning rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter is posed on. Mid-band, clear of both shores. */
const LANE_ROW = 4;

/** The kind parked on it: a raft3, which the lane table gives row 4. */
const LANE_KIND = "raft3";

/** The column the critter stands on. Mid-strait, clear of both edges. */
const CRITTER_COL = 20;

/** The column the parked floe sits at: on the row, far from the critter. */
const FLOE_COL = 8;

/** How many ticks the life may be taken within. See the header. */
const WINDOW_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports water footing and takes a life from a critter over open water", async () => {
  startCrossing(h, LEVEL);
  poseLane(h, LANE_ROW, LANE_KIND, [FLOE_COL]);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);

  // The scenario this check needs: the critter on a water row with its full
  // lives, and the row's one floe nowhere near its centre.
  const posed = h.snapshot();
  const floe = lastFloe(posed);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertTrue(
    !coversX(floe, posed.critter.x),
    `a ${LANE_KIND} parked on row ${LANE_ROW} clear of the critter's centre ` +
      `at x ${tileCX(CRITTER_COL)} (specs/water.md), was ${JSON.stringify(floe)}`,
  );

  // The requirement's first half: what the critter is standing on.
  assertEqual(
    posed.critter.footing,
    "water",
    `the footing on row ${LANE_ROW} at column ${CRITTER_COL}, which no floe ` +
      "covers (specs/strait.md)",
  );

  // Its second half: the tick that costs the life.
  const drowned = await captureReplay(h, "drown", () =>
    h.until((snapshot) => snapshot.lives < START_LIVES, {
      maxFrames: WINDOW_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    drowned.hit,
    `a life lost within ${WINDOW_TICKS} ticks of standing on open water ` +
      `(specs/water.md), was ${drowned.snapshot.lives} lives still in hand`,
  );
  assertEqual(
    drowned.snapshot.lives,
    START_LIVES - 1,
    "the lives left after falling in (specs/progression.md)",
  );
  assertEqual(
    drowned.snapshot.phase,
    "dying",
    "the phase a lost life leaves the crossing in (specs/progression.md)",
  );
});
