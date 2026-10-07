// water/floe-is-footing — a floe under the critter is safe footing, and stays
// safe.
//
// specs/strait.md derives the footing: on a row of the water band it is `floe`
// "while a floe on that row covers its center x". specs/water.md gives the
// consequence — the critter falls in only "on any tick on which its footing is
// `water`" — so a critter whose footing is `floe` loses nothing, however long it
// stands there. This is the other direction of `water/open-water-drowns`, and it
// is the half that fails a build that drowns the critter on the water band
// whatever it is standing on.
//
// THE FLOE IS PARKED, at the lane speed of `0` `poseLane` leaves, so what this
// reads is the footing and nothing else: a drifting lane would carry the critter
// (`water/floe-carries`) and eventually sweep it off an edge
// (`water/off-edge-left`), and those are their own items. Held still, the only
// thing that can take a life in the three seconds below is a build that thinks
// the water band itself is lethal.
//
// THREE SECONDS is the item's own figure, and at the fixed `TICK_HZ` (`120`)
// `specs/overview.md` gives it that is three hundred and sixty ticks of the same
// footing derivation — enough that a build that drowns a rider on some later
// tick, on a timer or on a re-derivation, is caught rather than sampled past.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO. `startCrossing` clears both rosters and
// shuts the four world gates, so nothing else on the strait can cost the life
// this check is watching for (specs/progression.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { START_LIVES, tileCX } from "../constants";
import {
  captureReplay,
  covers,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The footing rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter rides. Mid-band, clear of both shores. */
const LANE_ROW = 7;

/** The kind parked on it: a raft3, which the lane table gives row 7. */
const LANE_KIND = "raft3";

/** The column the critter stands on, and the parked raft's leftmost column. */
const CRITTER_COL = 20;
const FLOE_COL = CRITTER_COL - 1;

/** The game time the critter stands there, in seconds. The item's own figure. */
const RIDE_SECONDS = 3;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports floe footing and costs no life over three seconds on a parked floe", async () => {
  const { debug } = harness;
  await startCrossing(harness, LEVEL);
  await poseLane(harness, LANE_ROW, LANE_KIND, [FLOE_COL]);
  await debug.setCritterTile(CRITTER_COL, LANE_ROW);

  // The scenario this check needs: the critter on a water row with its full
  // lives, standing where the parked floe covers its centre.
  const posed = await harness.snapshot();
  const floe = lastFloe(posed);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertTrue(
    floe !== undefined && covers(floe, posed.critter.x),
    `a ${LANE_KIND} parked on row ${LANE_ROW} covering the critter's centre ` +
      `at x ${tileCX(CRITTER_COL)} (specs/water.md), was ${JSON.stringify(floe)}`,
  );

  // The requirement's first half: what the critter is standing on.
  assertEqual(
    posed.critter.footing,
    "floe",
    `the footing on row ${LANE_ROW} at column ${CRITTER_COL}, which the ` +
      `parked floe covers (specs/strait.md)`,
  );

  // Its second half: what three seconds of standing there costs.
  const after = await captureReplay(harness, "ride", async () => {
    await harness.advance(ticksFor(RIDE_SECONDS));
    return harness.snapshot();
  });

  assertEqual(
    after.lives,
    START_LIVES,
    `the lives left after ${RIDE_SECONDS} s on a floe (specs/water.md: only ` +
      `a footing of water costs one)`,
  );
  assertEqual(
    after.phase,
    "crossing",
    `the phase after ${RIDE_SECONDS} s on a floe, which no death has ` +
      `interrupted (specs/progression.md)`,
  );
  assertEqual(
    after.critter.present,
    true,
    `the critter still on the strait after ${RIDE_SECONDS} s on a floe`,
  );
  assertEqual(
    after.critter.footing,
    "floe",
    `the footing after ${RIDE_SECONDS} s on the same parked floe`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
