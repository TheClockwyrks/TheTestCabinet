// overload/fills-no-resonance — neither the charge nor the overload fills the meter.
//
// specs/mode.md: "A mismatched shot, and the shot that overloads a drone, each add
// nothing to the score and nothing to the resonance meter." specs/resonance.md says
// the same from the other side and admits no third case: exactly two events fill
// it — the hull absorbing an enemy bullet of the ship's own band, and one of the
// player's bullets destroying a drone by MATCHING its band — and nothing else moves
// the meter. A wrong-band shot is neither, whatever it does to the drone.
//
// BOTH SHOTS ARE READ, in one scenario, because the rule the specification states
// covers both and a build can get them apart: the drone is posed at charge 1, the
// first mismatched shot carries it to 2 — an ordinary charging shot — and the
// second tips it over. The meter is read after each, so the failure names which of
// the two moved it.
//
// THE METER IS POSED HALF FULL rather than empty. The two fills specs/resonance.md
// states are small figures: against a posed 0 a build that also DECAYED the meter
// would read 0 and pass, and against 50 every wrong model reads a different number
// — more for a build that fills, 0 for one that clears it, 50 for a conforming one.
// It is well below `RESONANCE_MAX` (`100`), so nothing here can arm a discharge.
//
// The drone is a prop with every faculty off and nothing is destroyed, so no
// matching kill and no absorbed bullet can reach the meter over the scenario.
//
// WHAT THIS DOES NOT DECIDE. What DOES fill the meter, which is the `resonance`
// group's; and that a mismatched shot pays no score, which is
// `overload/mismatch-scores-nothing` and `overload/overload-scores-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import {
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  RESONANCE_MAX,
  SHARD_HALF,
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
import { chargeById, mismatchShot, poseCharge } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/**
 * The meter the run is posed at before the two shots, in points.
 *
 * Half of `RESONANCE_MAX` (`100`): far enough above 0 that a build which cleared
 * the meter reads differently from one that left it alone, far enough below the
 * ceiling that neither fill specs/resonance.md states could be lost to the cap,
 * and nowhere near arming a discharge.
 */
const POSED_RESONANCE = RESONANCE_MAX / 2;

/** The charge the drone is posed at, so the FIRST shot is an ordinary charging one. */
const POSED_CHARGE = 1;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target each shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames each flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever sub-step a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the resonance meter where it stood through a charge and an overload", async () => {
  startPosed(h);
  h.debug.setResonance(POSED_RESONANCE);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, target, POSED_CHARGE);

  const charging = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    charging.hit,
    true,
    "the charging shot resolving inside its flight",
  );
  assertEqual(
    chargeById(charging.snapshot, target, "the drone the first shot fed"),
    OVERLOAD_AT - 1,
    "the charge that says the first shot really was a mismatch that landed " +
      "(specs/mode.md)",
  );
  assertEqual(
    charging.snapshot.resonance,
    POSED_RESONANCE,
    "the meter after a wrong-band shot that charged a drone, which adds nothing " +
      "to it (specs/mode.md, specs/resonance.md)",
  );

  const overloading = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "meter");

  assertEqual(
    overloading.hit,
    true,
    "the overloading shot resolving inside its flight",
  );
  assertEqual(
    chargeById(
      overloading.snapshot,
      target,
      "the drone that has just overloaded",
    ),
    0,
    "the charge that says the second shot really did overload the drone " +
      "(specs/mode.md)",
  );
  assertEqual(
    overloading.snapshot.resonance,
    POSED_RESONANCE,
    "the meter after the shot that overloads a drone, which adds nothing to it " +
      "(specs/mode.md, specs/resonance.md)",
  );
});
