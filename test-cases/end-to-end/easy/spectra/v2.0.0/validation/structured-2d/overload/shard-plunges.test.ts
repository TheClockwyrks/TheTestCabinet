// overload/shard-plunges — an overloaded Shard drops out of the formation at the ship.
//
// specs/mode.md gives the Shard's reaction: "It enters phase `diving` in the frame
// it overloads and plunges down the field toward the ship's current `x`". Two
// clauses, and both are read: the phase in the frame the shot resolved, and where
// the drone goes over the run that follows.
//
// THE POSE IS THE DISTINGUISHING ONE. The ship is parked far to one side of its
// lane and the Shard is posed high in the field on the FAR side, so a build that
// plunges straight down and one that plunges at the ship read completely different
// numbers: the horizontal gap between them opens at 840 units, and a build running
// a fixed track never closes it. Posing the two on the same `x` would have made
// every model look alike.
//
// WHAT IS MEASURED, AND WHY IT IS MEASURED THAT WAY. The drone's centre is sampled
// every frame of the run, and the two readings taken off that track are the
// DEEPEST point it reached and the CLOSEST it came to the ship's `x`. Extremes
// rather than the endpoint, for two reasons the specification itself gives:
// specs/swarm.md opens a dive with a swing that keeps it wide enough to dodge, so
// a gap read at one instant may be one the run has not closed yet; and it lets a
// dive that leaves below `FIELD_BOTTOM` re-appear above `FIELD_TOP`, so a depth
// read at one instant may be one a wrap has already undone. An extreme over the
// whole run is the reading neither of those can spoil.
//
// THE FACULTY POSED ON IS ITS LOCOMOTION AND ONLY THAT. Its firing stays off, so
// no bullet it spawns on the way down can reach anything, and the ship's contact
// gate stays shut, so the plunge is never cut short by arriving. The wave's dive
// launching stays shut too: the only thing that can put this drone into a dive is
// the overload.
//
// WHAT THIS DOES NOT DECIDE. How FAST the plunge travels, which is
// `overload/shard-plunge-faster`; and where an ordinary dive goes, which is the
// `swarm` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  SHARD_HALF,
  SHIP_X_MIN,
} from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/**
 * Where the ship is parked, in logical units along its lane.
 *
 * Well inside `[SHIP_X_MIN, SHIP_X_MAX]` (`40` to `1240`, specs/ship.md) so no
 * clamp moves it, and far to the left, so the target below opens a gap no build
 * can close by accident.
 */
const SHIP_AT = SHIP_X_MIN + 160;

/**
 * Where the target Shard stands, in logical units.
 *
 * High in the play field — clear of `FIELD_TOP` (`64`) by more than the
 * `SHARD_SIZE` (`28`) footprint it is drawn at — and on the opposite side of the
 * field from the ship, so the whole depth of the field is under it.
 */
const TARGET_X = 1040;
const TARGET_Y = FIELD_TOP + 136;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever sub-step a build resolves the contact on. The drone rides
 * the formation sway over that flight, which the contact reach covers.
 */
const SHOT_FRAMES = 30;

/**
 * How long the plunge is watched, in seconds, and the frames that covers.
 *
 * At `DIVE_SPEED` (`300`) times `OVERLOAD_DIVE_SCALE` (`1.6`) the plunge covers
 * 768 units of path over this window, which is more than the field is deep and
 * nearly as far as the 840-unit gap to the ship — long enough for a run that opens
 * wide to have turned back in, short enough that specs/swarm.md's ceiling on how
 * long a dive may last is nowhere near.
 */
const PLUNGE_SECONDS = 1.6;
const PLUNGE_FRAMES = ticksFor(PLUNGE_SECONDS);

/**
 * How far down the field the plunge must have carried the drone, in logical units.
 *
 * A fifth of the 768 units of path the window covers. specs/mode.md fixes no
 * gradient — "plunges down the field" is the whole of it, and the path is the
 * build's — so this is a floor that separates a run going DOWN from one running
 * across the field or turning straight back, and nothing narrower.
 */
const DESCENT_MIN = 150;

/**
 * How much of the horizontal gap to the ship the plunge must close, in logical
 * units.
 *
 * A quarter of the 840 units it opens at. specs/mode.md says the plunge goes
 * "toward the ship's current `x`" and fixes no rate of closing, and specs/swarm.md
 * lets a dive open wide before it comes in — so this is a floor that separates a
 * run aimed at the ship from a fixed track, and nothing narrower.
 */
const APPROACH_MIN = 210;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts an overloaded Shard into a dive that goes down the field at the ship", async () => {
  startPosed(h);
  h.debug.setShipX(SHIP_AT);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: "cyan",
    // Its locomotion, because where the plunge goes is what this point reads.
    travel: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );

  const overloaded = requireDrone(
    shot.snapshot,
    target,
    "the Shard the overload leaves standing",
  );
  assertEqual(
    overloaded.phase,
    "diving",
    "the phase an overloaded Shard enters in the frame it overloads " +
      "(specs/mode.md)",
  );
  const shipX = shot.snapshot.ship.x;
  const openedAt = Math.abs(overloaded.x - shipX);

  let deepest = overloaded.y;
  let closest = openedAt;
  await captureReplay(h, "plunge", async () => {
    for (let frame = 0; frame < PLUNGE_FRAMES; frame += 1) {
      await h.advance(1);
      const drone = requireDrone(
        h.snapshot(),
        target,
        "the plunging Shard, which nothing in this scenario destroys",
      );
      deepest = Math.max(deepest, drone.y);
      closest = Math.min(closest, Math.abs(drone.x - shipX));
    }
  });

  assertGreaterThanOrEqual(
    deepest - overloaded.y,
    DESCENT_MIN,
    "the units the plunge carried the Shard DOWN the field over " +
      `${String(PLUNGE_SECONDS)} s, taken at the deepest point of its run ` +
      "(specs/mode.md)",
  );
  assertLessThanOrEqual(
    closest,
    openedAt - APPROACH_MIN,
    `the units between the plunging Shard and the ship's x (${String(shipX)}) ` +
      `at the closest point of its run, from the ${String(Math.round(openedAt))} ` +
      "it opened at: a plunge goes toward the ship's current x (specs/mode.md)",
  );
});
