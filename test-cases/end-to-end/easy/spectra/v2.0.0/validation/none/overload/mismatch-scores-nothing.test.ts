// overload/mismatch-scores-nothing — a wrong-band shot pays nothing.
//
// specs/mode.md, under this mode: "A mismatched shot, and the shot that overloads a
// drone, each add nothing to the score and nothing to the resonance meter."
// specs/scoring.md says the same from the other side — "A shot that destroys no
// drone pays nothing" — and a mismatched shot destroys nothing (specs/bands.md).
// So charging a drone is not an achievement the game pays for.
//
// THE SCORE IS POSED AT A DISTINCTIVE NON-ZERO FIGURE, so the reading separates the
// two ways a build can get this wrong: one that PAYS for the charge reads more than
// the posed figure — `SCORE_SHARD_FORM` (50) more if it pays a kill's price — and
// one that CLEARS or rewrites the score reads something else again. Posing zero
// would have made "paid nothing" and "cleared the score" the same number.
// `setScore` is a precondition and nothing more: specs/instrumentation.md states
// that it grants no extra life and leaves `extraLifeAwarded` where it stands.
//
// THE SHOT IS A CHARGING ONE, not an overloading one: the drone is posed at the
// charge `addDrone` gives it, so this reads what the ordinary wrong-band shot pays.
// What the OVERLOADING shot pays is `overload/overload-scores-nothing`, and a build
// that pays for one and not the other grades differently on the two.
//
// The drone is a prop with every faculty off, so nothing but the shot happens over
// the scenario, and no drone is destroyed — so no stage clears and no
// `SCORE_STAGE_CLEAR` can reach the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * The score the run is posed at before the shot.
 *
 * A round figure that is not one of `specs/scoring.md`'s and not zero, so a build
 * that pays for the charge, one that clears the score, and one that leaves it alone
 * all read differently. Nothing in the scenario can move it: the extra life is paid
 * at `EXTRA_LIFE_AT` (20000), far above this.
 */
const POSED_SCORE = 500;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves the score exactly where it stood when a wrong-band shot charges a drone", async () => {
  await startPosed(harness);
  await harness.debug.setScore(POSED_SCORE);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "score");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  assertEqual(
    chargeOf(
      requireDrone(shot.snapshot, target, "the drone the mismatched shot fed"),
      "the drone the mismatched shot fed",
    ),
    1,
    "the charge that says the shot really was a mismatch that landed " +
      "(specs/mode.md); `overload/mismatch-charges` is the point that grades it",
  );
  assertEqual(
    shot.snapshot.score,
    POSED_SCORE,
    "the score after a wrong-band shot, which adds nothing to it (specs/mode.md)",
  );
});
