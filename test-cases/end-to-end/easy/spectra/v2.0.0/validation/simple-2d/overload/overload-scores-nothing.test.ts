// overload/overload-scores-nothing — the overloading shot pays nothing either.
//
// specs/mode.md: "A mismatched shot, AND THE SHOT THAT OVERLOADS A DRONE, each add
// nothing to the score and nothing to the resonance meter." An overload makes the
// drone more dangerous; it is not a kill and specs/scoring.md pays for nothing else
// ("Nothing else adds to the score").
//
// THE DIRECTION THIS POINT ADDS. `overload/mismatch-scores-nothing` reads the ordinary
// charging shot; this one reads the shot that tips the drone over. A build that treats
// the overload as an event worth paying for — the reaction it triggers looks like a
// kill from the scoring path's side — pays here and not there, so the two grade
// differently.
//
// THE SCORE IS POSED AT A DISTINCTIVE NON-ZERO FIGURE for the reason that point gives:
// a build that pays and one that clears the score then read different numbers.
//
// THE OVERLOAD IS REAL. The drone is posed at `OVERLOAD_AT - 1` — the precondition —
// and a real mismatched shot tips it over, and the charge read back at 0 is what says
// the overload actually happened rather than the shot having been absorbed.
//
// The drone is a prop with every faculty off, so the reaction cannot carry it into
// anything else that scores, and nothing is destroyed, so no stage clears and no
// `SCORE_STAGE_CLEAR` can reach the reading.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeById, mismatchShot } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * The score the run is posed at before the shot.
 *
 * A round figure that is not one of `specs/scoring.md`'s and not zero, so a build that
 * pays for the overload, one that clears the score, and one that leaves it alone all
 * read differently.
 */
const POSED_SCORE = 500;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score exactly where it stood when a wrong-band shot overloads a drone", async () => {
  startPosed(h);
  h.debug.setScore(POSED_SCORE);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
  });

  await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "score");

  assertEqual(
    chargeById(h.snapshot(), target, "the drone that has just overloaded"),
    0,
    "the charge that says the shot really did overload the drone " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );
  assertEqual(
    h.snapshot().score,
    POSED_SCORE,
    "the score after the shot that overloads a drone, which adds nothing to it " +
      "(specs/mode.md)",
  );
});
