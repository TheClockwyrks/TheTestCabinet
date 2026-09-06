// instrumentation/next-saucer-aim — `setNextSaucerAim` decides the aim error of
// the saucer's next shot, and the shot consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws":
// `setNextSaucerAim(radians)` "poses the aim error of the next shot the saucer
// fires, in radians, in place of the draw from `-SAUCER_AIM_ERROR` to
// `+SAUCER_AIM_ERROR`", reported as `nextSaucerAim`, and the shot consumes it.
//
// THE SCENARIO IS `saucer/shots.ts`'S: the saucer held still with its mind off
// and the ship posed four hundred units away, so the bearing to the ship is a
// figure this check knows and the round's bearing, less the saucer's own velocity
// of zero, is the aim. Two shots on one visit, posed with opposite errors near
// the edge of the range, so a build that ignores the pose and draws — which lands
// within the tolerance of either by chance about one time in forty — cannot land
// on both.
//
// THE TOLERANCE is half a degree: a bearing read off a velocity up to three ticks
// old, at a place where the well turns a round by `0.05` degrees over them,
// against an error posed eight degrees off the bearing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { DEG } from "../constants";
import { angleDelta } from "../geometry";
import { captureStill, poseShip, startPlaying, type Harness } from "../harness";
import {
  collectShots,
  createShotHarness,
  framesFor,
  poseGunner,
  SHOT_TICKS_PER_FRAME,
} from "../saucer/shots";

/** Where the gunner stands, at rest. See `saucer/aims-at-the-ship` for why here. */
const GUN_POSE = { x: 60, y: 60, vx: 0, vy: 0 };

/** Where the ship is posed: 400 units away, along the row the gunner is on. */
const SHIP_X = 460;
const SHIP_Y = 60;

/** The two errors posed, in degrees: near the edge of the range, opposite ways. */
const POSED_ERRORS_DEG = [8, -8] as const;

/** How far the read aim may stand from the posed one, in degrees. */
const AIM_TOLERANCE_DEG = 0.5;

/** How long a wait for one shot runs, in seconds: a little over one interval. */
const BUDGET = 3;

/** The decimal places the posed error is read back to: exactly. */
const READ_BACK_DIGITS = 9;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires the next shot with the posed aim error and consumes the pose", async () => {
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  for (const [index, errorDeg] of POSED_ERRORS_DEG.entries()) {
    h.debug.setNextSaucerAim(errorDeg * DEG);
    assertCloseTo(
      h.snapshot().nextSaucerAim ?? Number.NaN,
      errorDeg * DEG,
      READ_BACK_DIGITS,
      `setNextSaucerAim(${errorDeg} degrees) read back before the shot ` +
        "(specs/instrumentation.md)",
    );

    const shots = await collectShots(
      h,
      GUN_POSE,
      1,
      framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
    );
    const consumed = h.snapshot().nextSaucerAim;
    if (index === 0) {
      // The shot leaving at the posed error. The collection runs undrawn, so one
      // frame is drawn for the picture, after the reading was taken.
      await h.paint();
      captureStill(h, "posed");
    }

    assertLength(
      shots,
      1,
      `a round fired inside ${BUDGET} s of game time — the saucer fires one ` +
        "every SAUCER_FIRE_INTERVAL it is on the field (specs/saucer.md)",
    );
    const shot = shots[0];
    const error = angleDelta(shot.aimed, shot.heading) / DEG;
    assertEqual(
      Math.abs(error - errorDeg) <= AIM_TOLERANCE_DEG,
      true,
      `degrees between the shot's aim and the bearing to the ship, read ` +
        `${error.toFixed(3)} against the posed ${errorDeg} within ` +
        `${AIM_TOLERANCE_DEG} (specs/instrumentation.md)`,
    );
    assertEqual(
      consumed,
      null,
      `nextSaucerAim once the shot posed at ${errorDeg} degrees has consumed ` +
        "it (specs/instrumentation.md)",
    );
  }
});
