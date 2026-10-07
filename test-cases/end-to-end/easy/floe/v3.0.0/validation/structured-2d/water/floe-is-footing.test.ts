// Floe — water/floe-is-footing: a floe under the critter is safe footing, and
// stays safe.
//
// specs/strait.md derives the footing: on a row of the water band it is `floe`
// while a floe of that row covers its center. specs/water.md gives the
// consequence — the critter falls in only "on any tick on which its footing is
// `water`" — so a critter whose footing is `floe` loses nothing, however long it
// stands there. This is the other direction of `water/open-water-drowns`, and it
// is the half that fails a build that drowns the critter on the water band
// whatever it is standing on.
//
// THE FLOE IS A PAN, WHICH IS ONE TILE. That is what leaves this item deciding
// one thing: whether a floe under the critter is safe footing at all. A pan
// spans exactly the tile the critter stands on, so no reading here rests on how
// a build resolves the MIDDLE of a longer span — that is
// `water/raft-spans-are-solid`'s requirement, and a build that gets it wrong
// must fail there and pass here.
//
// THE FLOE IS PARKED, at the lane speed of `0` `poseLane` leaves, so what this
// reads is the footing and nothing else: a drifting lane would carry the critter
// (`water/floe-carries`) and eventually sweep it off an edge
// (`water/off-edge-left`), and those are their own items. Held still, the only
// thing that can take a life in the three seconds below is a build that thinks
// the water band itself is lethal.
//
// THREE SECONDS is the item's own figure, and at the fixed `TICK_HZ` (`120`)
// specs/overview.md gives it that is three hundred and sixty ticks of the same
// footing derivation — enough that a build that drowns a rider on some later
// tick, on a timer or on a re-derivation, is caught rather than sampled past.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO. `startCrossing` clears both rosters and
// shuts the four world gates, so nothing else on the strait can cost the life
// this check is watching for (specs/progression.md).

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX } from "../constants";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  floeById,
  itemCoversPoint,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The footing rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter rides. Mid-band, clear of both shores. */
const LANE_ROW = 8;

/** The kind parked on it: a pan, which the lane table gives row 8. */
const LANE_KIND = "pan";

/** The column the critter stands on, which is the whole of the parked pan. */
const CRITTER_COL = 20;
const FLOE_COL = CRITTER_COL;

/** The game time the critter stands there, in seconds. The item's own figure. */
const RIDE_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports floe footing and costs no life over three seconds on a parked floe", async () => {
  startCrossing(h, LEVEL);
  const [floeId] = poseLane(h, LANE_ROW, LANE_KIND, [FLOE_COL]);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);

  // The scenario this check needs: the critter on a water row with its full
  // lives, standing where the parked floe covers its centre.
  const posed = h.snapshot();
  const floe = floeById(posed, floeId);
  assertDefined(floe, `the ${LANE_KIND} posed on row ${LANE_ROW}`);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertTrue(
    floe !== undefined && itemCoversPoint(floe, posed.critter.x),
    `a ${LANE_KIND} parked on row ${LANE_ROW} covering the critter's centre ` +
      `at x ${tileCX(CRITTER_COL)} (specs/water.md), was ${JSON.stringify(floe)}`,
  );

  // The requirement's first half: what the critter is standing on.
  assertEqual(
    posed.critter.footing,
    "floe",
    `the footing on row ${LANE_ROW} at column ${CRITTER_COL}, which the ` +
      "parked pan covers (specs/strait.md)",
  );

  // Its second half: what three seconds of standing there costs.
  const after = await captureReplay(h, "ride", async () => {
    await h.advance(ticksFor(RIDE_SECONDS));
    return h.snapshot();
  });

  assertEqual(
    after.lives,
    START_LIVES,
    `the lives left after ${RIDE_SECONDS} s on a floe (specs/water.md: only a ` +
      "footing of water costs one)",
  );
  assertEqual(
    after.phase,
    "crossing",
    `the phase after ${RIDE_SECONDS} s on a floe, which no death has ` +
      "interrupted (specs/progression.md)",
  );
  assertEqual(
    after.critter.present,
    true,
    `the critter still on the strait after ${RIDE_SECONDS} s on a floe`,
  );
  assertEqual(
    after.critter.footing,
    "floe",
    `the footing after ${RIDE_SECONDS} s on the same parked pan`,
  );
});
