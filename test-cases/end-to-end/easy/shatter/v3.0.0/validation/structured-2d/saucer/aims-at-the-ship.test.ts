// saucer/aims-at-the-ship — the saucer's rounds go where the ship is.
//
// THE RULE. `specs/saucer.md`, Firing: the saucer "fires one saucer bullet aimed
// at the ship's current position", and "the shot's bearing is the bearing from the
// saucer to the ship, offset by an angle drawn afresh for every shot, uniformly
// from `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR` (`10` degrees)".
//
// THE ERROR IS POSED AT ZERO, SO THE AIM IS READ DIRECTLY. The draw is what
// stands between a shot and the bearing to the ship, and
// `specs/instrumentation.md` gives the surface `setNextSaucerAim`, which sets the
// outcome of that draw for the next shot. With it posed at `0` the round has to
// leave along the bearing to the ship exactly, and the reading is one shot rather
// than the mean of a sample. The draw's own range and scatter are
// `aim-error-within-10-degrees`'s and `aim-error-varies-per-shot`'s items, read
// off unposed shots.
//
// TWO GUNNERS, ON OPPOSITE SIDES OF THE SHIP, so a build that fires along a fixed
// bearing, or at the ship's safe point rather than at the ship, reads wrong on at
// least one of them. Each is posed at rest with its mind and travel shut, so its
// own velocity is zero and the round's velocity is the aim (`shots.ts`); the ship
// stands `400` units from either, at rest with its lethal contact test shut.
//
// THE TOLERANCE IS HALF A DEGREE, and it is a reading cost rather than room on
// the rule. A round is ballistic from the moment it leaves, and this point
// samples every `SHOT_TICKS_PER_FRAME` ticks, so a reading can be up to three
// ticks old: at `(60, 60)` the well turns a `300`-unit-per-second round by
// `0.05` degrees over those ticks, and at `(860, 60)`, `372` units from the star,
// by `0.16`. A build that aims a whole degree off is twice the bound out.
//
// WHAT THIS DOES NOT DECIDE. The bound on the error (`aim-error-within-10-degrees`)
// or that it is redrawn (`aim-error-varies-per-shot`).

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../constants";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { angleDelta } from "../geometry";
import { captureStill, poseShip, startPlaying, type Harness } from "../harness";
import {
  collectShots,
  createShotHarness,
  framesFor,
  poseGunner,
  SHOT_TICKS_PER_FRAME,
  type GunPose,
} from "./shots";

/** Where the ship is posed: on the top row of the field, clear of the star. */
const SHIP_X = 460;
const SHIP_Y = 60;

/** The two gunners, `400` units either side of the ship along its row, at rest. */
const GUN_POSES: readonly GunPose[] = [
  { x: SHIP_X - 400, y: SHIP_Y, vx: 0, vy: 0 },
  { x: SHIP_X + 400, y: SHIP_Y, vx: 0, vy: 0 },
];

/** How long a wait for one shot runs, in seconds: a little over one interval. */
const BUDGET = 3;

/** How far the shot's aim may stand from the bearing to the ship, in degrees. */
const AIM_TOLERANCE_DEG = 0.5;

/** The decimal places the posed error is read back to: exactly. */
const READ_BACK_DIGITS = 9;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires a shot with no aim error straight along the bearing to the ship", async () => {
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });

  for (const [index, pose] of GUN_POSES.entries()) {
    h.debug.clearEnemyBullets();
    h.debug.removeSaucer();
    poseGunner(h, pose);
    h.debug.setNextSaucerAim(0);
    assertCloseTo(
      h.snapshot().nextSaucerAim ?? Number.NaN,
      0,
      READ_BACK_DIGITS,
      "setNextSaucerAim(0) read back before the shot (specs/instrumentation.md)",
    );

    const shots = await collectShots(
      h,
      pose,
      1,
      framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
    );
    if (index === 0) {
      // The shot leaving straight for the ship. The collection runs undrawn, so
      // one frame is drawn for the picture, after the reading was taken.
      await h.paint();
      captureStill(h, "aim");
    }

    assertLength(
      shots,
      1,
      `a round fired from (${pose.x}, ${pose.y}) inside ${BUDGET} s of game ` +
        "time — the saucer fires one every SAUCER_FIRE_INTERVAL it is on the " +
        "field (specs/saucer.md)",
    );
    const shot = shots[0];
    assertEqual(
      Math.abs(angleDelta(shot.aimed, shot.heading)) / DEG <= AIM_TOLERANCE_DEG,
      true,
      `degrees between the shot's aim and the bearing from (${pose.x}, ` +
        `${pose.y}) to the ship, with the aim error posed at 0: read ` +
        `${(Math.abs(angleDelta(shot.aimed, shot.heading)) / DEG).toFixed(3)} ` +
        `against ${AIM_TOLERANCE_DEG} — the shot is aimed at the ship's current ` +
        "position (specs/saucer.md)",
    );
  }
});
