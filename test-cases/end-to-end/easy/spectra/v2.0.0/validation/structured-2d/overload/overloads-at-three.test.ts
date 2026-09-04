// overload/overloads-at-three — the third mismatched shot overloads the drone.
//
// specs/mode.md fixes where the counting stops: "A mismatched shot into a drone
// already at `OVERLOAD_AT - 1` or above overloads it instead: it runs the reaction
// for its kind, below, and its charge returns to `0`. The third mismatched shot a
// drone takes therefore overloads it."
//
// SO THIS POINT IS ABOUT THE TRIGGER, not about any one reaction. The drone is
// posed at `OVERLOAD_AT - 1` — the precondition — and tipped over with a real
// mismatched shot — the trigger — and what is read back is that a reaction RAN.
//
// A SHARD IS THE DRONE, AND ITS REACTION IS THE MARKER. specs/mode.md's table
// gives the Shard the one reaction that shows in a field every snapshot carries:
// "It enters phase `diving` in the frame it overloads". So the reading is the
// drone's phase in the frame the shot resolved, and it separates the three wrong
// models cleanly:
//
//   * a build that overloads at a HIGHER charge leaves the drone in `formation` at
//     charge 3 and fails here;
//   * a build that overloads at a LOWER one has already reacted before this shot,
//     and fails `overload/charge-advances`, which carries a drone 0 to 1 to 2 with
//     no reaction in between;
//   * a build that never overloads at all leaves it in `formation` and fails here.
//
// Its locomotion is the one faculty posed on, because entering a dive is what the
// reaction IS; its firing stays off, so no bullet it spawns can reach anything, and
// its oscillation gates nothing on a Shard.
//
// WHAT THIS DOES NOT DECIDE. Where that plunge goes and how fast, which are
// `overload/shard-plunges` and `overload/shard-plunge-faster`; that the charge
// returns to 0, which is `overload/charge-resets`; and the Flux's and the Prism's
// reactions, which are their own points.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  SHARD_HALF,
  SWAY_AMP,
} from "../constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/**
 * Where the target Shard stands, in logical units.
 *
 * High in the play field, on the ship's own lane: clear of `FIELD_TOP` (`64`),
 * with room under it for the shot's climb and room below it for the plunge the
 * reaction opens, so the drone is nowhere near the bottom of the field when the
 * reading is taken.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever sub-step a build resolves the contact on. The drone rides the
 * formation sway over that flight — `SWAY_AMP` (`20`) either side of its slot at
 * most, and specs/swarm.md's `SWAY_PERIOD` (`5`) s carries it only a fraction of
 * that in 0.3 s — which the contact reach covers.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs the drone's reaction on a wrong-band shot into it at OVERLOAD_AT minus one", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: "cyan",
    // Its locomotion, because entering a dive is the reaction being read.
    travel: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  assertEqual(
    requireDrone(h.snapshot(), target, "the posed Shard").phase,
    "formation",
    "the phase a Shard posed in the formation rests in before the shot",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "overloaded");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot placed ${String(SHOT_BELOW)} units below a drone ` +
      `swaying at most ${String(SWAY_AMP)} units either side of its slot ` +
      `resolved inside the ${String(SHOT_FRAMES)} frames its climb takes`,
  );
  assertEqual(
    requireDrone(
      shot.snapshot,
      target,
      "the drone the overloading shot found, which an overload never destroys",
    ).phase,
    "diving",
    `the phase a Shard at charge ${String(OVERLOAD_AT - 1)} enters in the frame ` +
      "a mismatched shot overloads it, rather than resting on at a higher charge " +
      "(specs/mode.md)",
  );
});
