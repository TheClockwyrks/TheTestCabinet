// progression/ready-hold — a lost life holds the wave in `ready` for READY_HOLD.
//
// `specs/progression.md`: "Losing a life with lives to spare puts the live wave
// into its `ready` phase. The phase lasts `READY_HOLD` (`1.3`) seconds, then the
// wave returns to the `live` phase."
//
// SO THE MEASUREMENT IS THE LENGTH OF THE HOLD, and both of its ends. The frame
// the phase first reads `ready` opens the window and the frame it first reads
// `live` again closes it, sampled ONE FRAME AT A TIME, so the reading has the
// resolution of the harness's 100 Hz clock — a hundredth of a second against a
// hold of 1.3. Three wrong models each read a different number: a build holding
// for a frame or two reads near zero, a build that never leaves `ready` fails on
// the return sweep, and a build holding the stage-intro's `STAGE_INTRO_HOLD`
// (`2.0 s`) or the stage-cleared `STAGE_CLEARED_HOLD` (`2.6 s`) by mistake reads
// a figure well outside the tolerance below.
//
// LIVES ARE LEFT AT `START_LIVES` (`3`), which is what "with lives to spare"
// means: a loss with no life left opens the game-over screen instead
// (`progression/game-over-at-zero`), and that is a different event.
//
// THE LOSS IS REAL, NOT POSED. Nothing here writes `phase`, `phaseTimer` or
// `lives`. One enemy bullet of the band opposite the ship's is placed above the
// hull and allowed to fall, and the build's own contact rules open the hold.
// `setShipContact(true)` puts back the one world gate `startPosed` shuts.
//
// WHAT THIS DOES NOT DECIDE. That the bullet cost exactly one life
// (`progression/bullet-costs-life`'s), where the ship comes back
// (`progression/respawn-centres-ship`'s), what the wave does across the hold
// (`progression/wave-persists`'s), or that the `READY` banner is drawn
// (`presentation/`'s).

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  bulletSpeedScale,
  opposite,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  seconds,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * Well clear of the hull's contact reach against an enemy bullet — `SHIP_HALF`
 * (`15`) plus `ENEMY_BULLET_HALF` (`8`), 23 units — so the contact is one the
 * fall produced.
 */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to open the hold.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame the bullet is placed on.
 */
const FALL_FRAMES = framesFor(DROP_ABOVE / FALL_SPEED) + 2;

/**
 * The fraction of `READY_HOLD` the measured hold may differ by: 20%, which is the
 * tolerance this review item states, `0.26 s` either side of `1.3`.
 *
 * It is generous against the hundredth-of-a-second resolution the sampling gives,
 * and deliberately so: a build is free to run the hold's timer down inside its
 * own sub-steps, or to end it on the frame it crosses zero rather than the frame
 * after, and neither is a defect. It is still far tighter than the gap to any
 * other hold the game keeps — `STAGE_INTRO_HOLD` (`2.0 s`) is 54% away and
 * `STAGE_CLEARED_HOLD` (`2.6 s`) is double.
 */
const HOLD_TOLERANCE = 0.2;

/**
 * Frames the return to `live` is given.
 *
 * Twice `READY_HOLD`, so a build holding for anything inside the tolerance is
 * seen returning and graded on the figure it held for, while a build that never
 * leaves `ready` fails on the sweep rather than on a number.
 */
const RETURN_FRAMES = framesFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the wave in the ready phase for READY_HOLD, then returns to live", async () => {
  await startPosed(h);
  // The one world gate this item's requirement rests on: without a contact test
  // no life is lost and no hold ever opens.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.phase, "live", "the phase the wave was posed in");

  const band = opposite(posed.ship.band);
  await poseEnemyBulletAbove(h, band, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_FRAMES,
  });
  // Kept while the hold is still standing, so the still shows the beat the lost
  // life opened rather than the field after it.
  await captureStill(h, "ready");
  assertEqual(
    opened.hit,
    true,
    `losing a life to the ${band} bullet putting the wave into its ready ` +
      `phase, inside the ${String(FALL_FRAMES)} frames the fall takes ` +
      "(specs/progression.md)",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_FRAMES,
  });
  assertEqual(
    returned.hit,
    true,
    "the wave returning to its live phase when the hold ended, inside " +
      `${String(seconds(RETURN_FRAMES))} s — twice READY_HOLD ` +
      "(specs/progression.md)",
  );
  assertBetween(
    seconds(returned.frames),
    READY_HOLD * (1 - HOLD_TOLERANCE),
    READY_HOLD * (1 + HOLD_TOLERANCE),
    `the seconds the ready phase held, against READY_HOLD (${String(READY_HOLD)}) ` +
      `within ${String(HOLD_TOLERANCE * 100)}% (specs/progression.md)`,
  );
});
