// ice/crush-only-on-arrival — a parked vehicle standing over the critter kills
// nothing; releasing its lane does.
//
// specs/ice.md states the rule in two directions and this check reads the
// negative one: "The critter is crushed on any tick on which a vehicle in a lane
// WHOSE SPEED IS ABOVE `0` covers the critter's center", and then, plainly, "A
// lane held at a speed of `0` moves nothing, so a critter standing where such a
// vehicle covers it is left as it stands."
//
// THIS IS THE HALF THAT SEPARATES ARRIVAL FROM OVERLAP. A build that costs a
// life whenever a vehicle's span happens to contain the critter's centre passes
// `ice/crush-kills` and fails here on its first tick, and that is exactly the
// distinction worth grading: the critter is put under the MIDDLE tile of a
// parked plow, which is the deepest inside a span it can be, and left there for
// three seconds of game time.
//
// AND THEN THE POSITIVE HALF, one tick of it. The same plow, the same critter,
// the same overlap — only the lane's speed changes, from `0` to the table's
// figure for row 11. On the first tick after that the vehicle is in a lane whose
// speed is above `0` and covers the critter's centre, so the rule takes a life.
// A build that read "arrival" as a body having to travel some distance first
// survives the three seconds and then survives the release too, and fails here
// where it should.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO BODIES. `startCrossing` clears both
// rosters and shuts the four world gates, so neither the life kept over three
// seconds nor the life lost at the end of them can have come from anything else
// that costs one (specs/progression.md).

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX, tileLeft } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
  createHarness,
  laneAt,
  lastVehicle,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The crush rule is the same at each. */
const LEVEL = 1;

/** The ice lane the two bodies are posed on: row 11, which carries a plow. */
const LANE_ROW = 11;

/** The column the critter stands on. Mid-strait, clear of both edges. */
const CRITTER_COL = 20;

/**
 * The leftmost column the parked plow spans.
 *
 * One left of the critter, so the critter's tile is the plow's MIDDLE tile and
 * its centre is a whole tile inside the span on both sides — the deepest overlap
 * a three-tile vehicle offers.
 */
const PLOW_COL = CRITTER_COL - 1;

/** The game time the critter is left under the parked plow, in seconds. */
const PARKED_SECONDS = 3;

/** The speed the lane is released at: the table's level-1 figure for row 11. */
const RELEASED_SPEED = 1.7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every life under a parked vehicle for three seconds, and takes one when the lane runs", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);
  poseLane(h, LANE_ROW, "plow", [PLOW_COL]);

  // The scenario this check needs: the critter's centre inside a parked plow's
  // span, with every life still in hand.
  const posed = h.snapshot();
  const plow = lastVehicle(posed);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertEqual(
    posed.critter.x,
    tileCX(CRITTER_COL),
    "the critter's centre on the tile it was posed on (specs/strait.md)",
  );
  assertTrue(
    coversX(plow, posed.critter.x),
    `a plow parked at x ${tileLeft(PLOW_COL)} on row ${LANE_ROW} covering the ` +
      `critter's centre at x ${tileCX(CRITTER_COL)} (specs/ice.md), was ` +
      `${JSON.stringify(plow)}`,
  );
  assertEqual(
    laneAt(posed, LANE_ROW).speed,
    0,
    `row ${LANE_ROW}: the lane held still under the parked plow ` +
      "(specs/instrumentation.md)",
  );

  const { held, released } = await captureReplay(h, "crush", async () => {
    await h.advance(ticksFor(PARKED_SECONDS));
    const parked = h.snapshot();
    h.debug.setLaneSpeed(LANE_ROW, RELEASED_SPEED);
    await h.advance(1);
    return { held: parked, released: h.snapshot() };
  });

  assertEqual(
    held.lives,
    START_LIVES,
    `the lives left after ${PARKED_SECONDS} s under a plow whose lane is held ` +
      "at a speed of 0 (specs/ice.md)",
  );
  assertEqual(
    held.critter.present,
    true,
    `the critter still on the strait after ${PARKED_SECONDS} s under a parked ` +
      "plow (specs/ice.md)",
  );
  assertEqual(
    held.phase,
    "crossing",
    `the phase after ${PARKED_SECONDS} s under a parked plow ` +
      '(specs/progression.md: a lost life makes it "dying")',
  );

  assertEqual(
    released.lives,
    START_LIVES - 1,
    "the lives left on the first tick after the same plow's lane was released " +
      `to ${RELEASED_SPEED} tiles a second (specs/ice.md)`,
  );
  assertEqual(
    released.phase,
    "dying",
    "the phase a lost life leaves the crossing in (specs/progression.md)",
  );
});
