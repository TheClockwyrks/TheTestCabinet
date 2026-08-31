// overload/overloads-at-three — the third mismatched shot overloads the drone.
//
// specs/mode.md fixes where the counting stops: "A mismatched shot into a drone
// already at `OVERLOAD_AT - 1` or above overloads it instead: it runs the reaction
// for its kind, below, and its charge returns to `0`. The third mismatched shot a
// drone takes therefore overloads it."
//
// SO THIS POINT IS ABOUT THE TRIGGER, not about any one reaction. The drone is posed
// at `OVERLOAD_AT - 1` — the precondition — and tipped over with a real mismatched
// shot — the trigger — and what is read back is that a reaction RAN.
//
// A SHARD IS THE DRONE, AND ITS REACTION IS THE MARKER. specs/mode.md's table gives
// the Shard the one reaction that shows in a field every snapshot carries: "It enters
// phase `diving` in the frame it overloads". So the reading is the drone's phase in
// the frame the shot resolved, and it separates the three wrong models cleanly:
//
//   * a build that overloads at a HIGHER charge leaves the drone in `formation` at
//     charge 3 and fails here;
//   * a build that overloads at a LOWER one has already reacted before this shot,
//     and fails `overload/charge-advances`, which carries a drone 0 to 1 to 2 with no
//     reaction in between;
//   * a build that never overloads at all leaves it in `formation` and fails here.
//
// Its locomotion is the one faculty posed on, because entering a dive is what the
// reaction IS; its firing stays off, so no bullet it spawns can reach anything.
//
// WHAT THIS DOES NOT DECIDE. Where that plunge goes and how fast, which are
// `overload/shard-plunges` and `overload/shard-plunge-faster`; that the charge
// returns to 0, which is `overload/charge-resets`; and the Flux's and the Prism's
// reactions, which are their own points.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/**
 * Where the target Shard stands.
 *
 * High in the play field, on the formation's own centre line: clear of `FIELD_TOP`
 * (64), with room under it for the shot's climb and room below it for the plunge the
 * reaction opens, so the drone is nowhere near the bottom of the field when the
 * reading is taken.
 */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6). The drone rides the formation
 * sway over that climb, `SWAY_AMP` (20) either side of its slot at most, and the
 * shot is placed under the centre the snapshot reported at the moment it was fired.
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs the drone's reaction on a wrong-band shot into it at OVERLOAD_AT minus one", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
    // Its locomotion, because entering a dive is the reaction being read.
    travel: true,
  });

  assertEqual(
    droneOf(h.snapshot(), target).phase,
    "formation",
    "the phase a Shard posed in the formation rests in before the shot",
  );

  await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "overloaded");

  assertEqual(
    droneOf(h.snapshot(), target).phase,
    "diving",
    `the phase a Shard at charge ${String(OVERLOAD_AT - 1)} enters in the frame a ` +
      "mismatched shot overloads it, rather than resting on at a higher charge " +
      "(specs/mode.md)",
  );
});
