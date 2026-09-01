// progression/ready-hold — a lost life holds the wave in `ready` for READY_HOLD.
//
// specs/progression.md: "Losing a life with lives to spare puts the live wave
// into its `ready` phase. The phase lasts `READY_HOLD` (`1.3`) seconds, then the
// wave returns to the `live` phase."
//
// SO THE MEASUREMENT IS THE LENGTH OF THE HOLD, AND BOTH OF ITS ENDS. The frame
// the phase first reads `ready` opens the window and the frame it first reads
// `live` again closes it, sampled ONE FRAME AT A TIME, so the reading has the
// resolution of this suite's 120 Hz clock — a frame is `1/120` s against a hold
// of `1.3`. Three wrong models each read a different number: a build holding for
// a frame or two reads near zero, a build that never leaves `ready` fails on the
// return sweep rather than on a figure, and a build holding the stage intro's
// `STAGE_INTRO_HOLD` (`2.0` s) or the stage-cleared `STAGE_CLEARED_HOLD`
// (`2.6` s) by mistake reads a figure well outside the tolerance below.
//
// LIVES ARE LEFT AT `START_LIVES` (`3`), which is what "with lives to spare"
// means: a loss with no life left opens the game-over screen instead
// (`progression.game-over-at-zero`), and that is a different event.
//
// THE LOSS IS REAL, NOT POSED. Nothing here writes `phase`, `phaseTimer` or
// `lives` once the run is posed. One enemy bullet of the band opposite the ship's
// is placed above the hull and allowed to fall, and the build's own contact rules
// open the hold. `setShipContact(true)` puts back the one world gate `startPosed`
// shuts.
//
// WHAT THIS DOES NOT DECIDE. That the bullet cost exactly one life
// (`progression.bullet-costs-life`'s), where the ship comes back
// (`progression.respawn-centres-ship`'s), what the wave does across the hold
// (`progression.wave-persists`'s), or that the READY banner is drawn
// (`screens.ready-banner`'s).

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  SHIP_HALF,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** The band the ship holds, and the opposite one the bullet carries. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * Well clear of the hull's contact reach against an enemy bullet — `SHIP_HALF`
 * (`15`) plus `ENEMY_BULLET_HALF` (`8`), 23 units — so the contact is one the
 * fall produced.
 */
const DROP_ABOVE = 120;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to open the hold.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames of slack for the frame the bullet is placed on.
 */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/**
 * The fraction of `READY_HOLD` the measured hold may differ by: 20%, which is the
 * tolerance this review item states — `0.26` s either side of `1.3`.
 *
 * It is enormously generous against the `1/120` s resolution the frame-by-frame
 * sampling gives, and deliberately so: a build is free to run the hold's timer
 * down inside its own sub-steps, or to end it on the frame it crosses zero rather
 * than the frame after, and neither is a defect. It is still far tighter than the
 * gap to any other hold the game keeps — `STAGE_INTRO_HOLD` (`2.0` s) is 54% away
 * and `STAGE_CLEARED_HOLD` (`2.6` s) is double.
 */
const HOLD_TOLERANCE = 0.2;

/**
 * Frames the return to `live` is given.
 *
 * Twice `READY_HOLD`, so a build holding for anything inside the tolerance is
 * seen returning and graded on the figure it held for, while a build that never
 * leaves `ready` fails on the sweep rather than on a number.
 */
const RETURN_TICKS = ticksFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the wave in the ready phase for READY_HOLD, then returns to live", async () => {
  startPosed(h);
  // The one world gate this point's requirement rests on: without a contact test
  // no life is lost and no hold ever opens.
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(START_LIVES);
  assertEqual(h.snapshot().phase, "live", "the phase the wave was posed in");

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_TICKS,
  });
  // Kept while the hold is still standing, so the still shows the beat the lost
  // life opened rather than the field after it.
  captureStill(h, "ready");
  assertEqual(
    opened.hit,
    true,
    `losing a life to a ${BULLET_BAND} bullet dropped ${DROP_ABOVE} units ` +
      `above a ${SHIP_BAND} ship putting the wave into its ready phase inside ` +
      `${FALL_TICKS} frames (${seconds(FALL_TICKS)} s) — at ` +
      `ENEMY_BULLET_SPEED ${ENEMY_BULLET_SPEED} the ${DROP_ABOVE - TOUCHING} ` +
      "units to the contact take " +
      `${seconds(ticksFor((DROP_ABOVE - TOUCHING) / FALL_SPEED))} s ` +
      "(specs/progression.md)",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_TICKS,
  });
  assertEqual(
    returned.hit,
    true,
    "the wave returning to its live phase when the hold ended, inside " +
      `${seconds(RETURN_TICKS)} s — twice READY_HOLD ${READY_HOLD} ` +
      "(specs/progression.md)",
  );
  assertBetween(
    seconds(returned.frames),
    READY_HOLD * (1 - HOLD_TOLERANCE),
    READY_HOLD * (1 + HOLD_TOLERANCE),
    `the seconds the ready phase held, sampled one frame at a time from the ` +
      `frame it opened, against READY_HOLD ${READY_HOLD} within ` +
      `${HOLD_TOLERANCE * 100}% (specs/progression.md). ` +
      `${STAGE_INTRO_HOLD} is the stage intro's hold and ` +
      `${STAGE_CLEARED_HOLD} the stage-cleared interstitial's, both well ` +
      "outside it",
  );
});
