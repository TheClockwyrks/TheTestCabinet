// progression/off-edge-costs-life — a floe carrying the critter past a side edge
// costs the run exactly one life and puts the crossing into its dying hold.
//
// specs/progression.md lists being swept off among the five things that cost a
// life, and fixes what every one of them costs: "On the tick a life is lost:
// `lives` drops by exactly one, `phase` becomes `dying`, ... the critter leaves
// the strait". specs/water.md fixes the sweeping itself: "A critter carried to a
// side edge of the strait is lost. It loses a life on the tick its center `x`
// falls below `0` or rises above `STRAIT_W` (`1280`)."
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. Which edge and at what `x` is
// `water/off-edge-left` and `water/off-edge-right`; that a floe carries a rider at
// its lane's speed is `water/floe-carries`. This point is one of the five that ask
// whether the RUN answers a death, and it is the sweeping's own.
//
// THE CRITTER IS CARRIED OFF RATHER THAN POSED OFF. It stands on a one-tile `pan`
// laid in the leftmost column, and the lane is then given a leftward direction and
// a speed of this check's own choosing, so the centre that leaves the strait is
// carried out by the game's own lane motion. The drive is a fixed count of frames
// derived from THAT posed speed rather than a sweep.
//
// THE DRIVE IS IN TWO PARTS, AND THE FIRST IS WHAT MAKES THE POINT SPECIFIC. The
// critter's centre begins at `16`, half a tile in, so at `LANE_SPEED` tiles a
// second it is still on the strait at `MID` and past `0` by the end of `DRIVE`. A
// build that took the life the moment the critter was put on a floe, or on the tick
// the floe's own left edge crossed `0` — which happens on the very first tick
// here — is already dying at the first reading and fails there. So the two
// readings together say that the life went with the CENTRE leaving the strait
// rather than with anything else on the route.
//
// NOTHING BUT THE SWEEP CAN BE WHAT KILLED IT. The strait carries one floe and
// nothing else: the ice band is empty, the bears are cleared and the four world
// gates are shut, so no crush, no catch and no expiring timer is on the table. Nor
// can the ride become a fall: specs/water.md moves the floe and the rider it
// carries by the same `d * s * TILE` units per second, so a centre that was over
// the floe at `MID` is over it still for as long as it is on the strait, and the
// footing read at `MID` says so.
//
// WHAT IS READ AFTER THE SWEEP is the life, the phase and the critter's absence —
// the three things specs/progression.md fixes for a lost life. The centre itself is
// NOT read there: an absent critter has left the strait, and where a build leaves
// the coordinates of a body it has taken out of play is not something the
// specification fixes.
//
// The delta is read rather than the absolute, so a build that mis-posed the counter
// fails the point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The water row the ride happens on, and the column the floe is laid in. */
const ROW = 6;
const COL = 0;

/** The speed this check gives the lane, in tiles a second, and its direction. */
const LANE_SPEED = 1;
const LANE_DIR = -1;

/**
 * The two readings, in frames of carry.
 *
 * The critter's centre starts at `tileCX(0)` — `16` units — and the lane carries
 * it left at `LANE_SPEED * TILE` (`32`) units a second, so it reaches `0` at
 * exactly `0.5` s. `MID` is a quarter of a second in, where the centre is still `8`
 * units inside the strait; `DRIVE` carries it on to three quarters of a second,
 * where it is `8` units outside. Both lie inside the `DEATH_PAUSE` (`0.9` s) hold
 * that the crossing of `0` begins, so the phase read at the end is that hold.
 */
const MID = ticksFor(0.25);
const DRIVE = ticksFor(0.75) - MID;

/** Frames of the hold recorded after the reading, for the replay alone. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes one life and starts the dying hold when a floe carries the critter off the edge", async () => {
  startCrossing(h);
  poseLane(h, ROW, "pan", [COL]);
  h.debug.setCritterTile(COL, ROW);
  h.debug.setLaneDirection(ROW, LANE_DIR);
  h.debug.setLaneSpeed(ROW, LANE_SPEED);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the ride");
  assertEqual(
    before.critter.footing,
    "floe",
    "a critter riding the posed floe",
  );

  const { riding, swept } = await captureReplay(h, "death", async () => {
    await h.advance(MID);
    const onStrait = h.snapshot();
    await h.advance(DRIVE);
    const offStrait = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return { riding: onStrait, swept: offStrait };
  });

  // The situation the reading was taken in: a quarter of a second in, the centre
  // is still inside the strait, still on the floe, and the ride has cost nothing.
  assertEqual(
    riding.phase,
    "crossing",
    `still crossing with the centre at ${riding.critter.x}, inside the strait`,
  );
  assertGreaterThanOrEqual(
    riding.critter.x,
    0,
    "a centre still on the strait a quarter of a second into the ride",
  );
  assertEqual(riding.critter.footing, "floe", "still riding, not fallen in");
  assertEqual(
    riding.lives,
    before.lives,
    "a ride inside the strait costs no life",
  );

  assertEqual(
    before.lives - swept.lives,
    1,
    "the one life being swept off costs (specs/progression.md)",
  );
  assertEqual(swept.phase, "dying", "the hold a lost life starts");
  assertEqual(
    swept.critter.present,
    false,
    "a critter off the strait once it was swept off it",
  );
});
