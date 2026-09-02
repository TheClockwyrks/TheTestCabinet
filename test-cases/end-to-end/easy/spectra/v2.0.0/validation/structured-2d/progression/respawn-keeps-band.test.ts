// progression/respawn-keeps-band — the ship comes back holding the band it held.
//
// `specs/progression.md`, closing the ready hold: "When the hold ends, the ship
// reappears at the center of its lane, `(SHIP_X_MIN + SHIP_X_MAX) / 2`, holding the
// band it held." The sentence names two things and only the position is graded
// elsewhere: `progression/respawn-centres-ship` says outright that the band is not
// its reading. Which band the ship comes back on is not decoration — it decides
// what the player can destroy and what the ship can absorb on the first frame back
// (specs/bands.md) — so a build that respawns on `cyan` whatever the ship was tuned
// to changes the game silently.
//
// THE DISTINGUISHING POSE IS THE WHOLE CHECK. A run opens on `cyan`, and
// `debug.reset()` restores it (specs/instrumentation.md), so a scenario that lost a
// life while holding cyan would read `cyan` on a build that carries the band across
// the hold and on a build that hard-codes the respawn — the two are
// indistinguishable. So the ship is tuned to MAGENTA first, and now each model
// reads its own value.
//
// THE LIFE IS LOST THE WAY THE SPECIFICATION LOSES ONE: an enemy bullet of the
// OPPOSITE band dropped down the lane onto the ship, which specs/bands.md makes
// lethal rather than absorbed. Nothing about the hold is posed — the phase, its
// length and its end are all the build's own — and no key is ever pressed, so
// nothing but the respawn can decide the band that is read.
//
// THE READING IS TAKEN ON THE FIRST FRAME THE PHASE IS `live` AGAIN, which is the
// moment the specification names.
//
// WHAT THIS DOES NOT DECIDE. Where the ship comes back is
// `progression/respawn-centres-ship`'s; how long the hold lasts is
// `progression/ready-hold`'s; that the wave carries on across it is
// `progression/wave-persists`'s; that the bullet costs a life at all is
// `progression/bullet-costs-life`'s, and it is asserted below as the ground this
// reading stands on.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  START_LIVES,
  bulletSpeedScale,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/**
 * The band the ship is tuned to before it is hit.
 *
 * MAGENTA, the one a run does not open on: `specs/instrumentation.md` gives a fresh
 * run and every `reset()` a `cyan` ship, so a build that hard-codes the respawn's
 * band, or that rebuilds the ship from its title values, reads `cyan` here.
 */
const POSED_BAND = "magenta" as const;

/** The opposite band, which specs/bands.md makes lethal rather than absorbed. */
const BULLET_BAND = "cyan" as const;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the fall is given to open the hold: geometry, plus two of slack. */
const FALL_FRAMES = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/** Frames the return to `live` is given: twice `READY_HOLD` (`1.3 s`). */
const RETURN_FRAMES = ticksFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings the ship back holding the band it held when it died", async () => {
  startPosed(h);
  // The distinguishing pose: the band a run never opens on.
  h.debug.setShipBand(POSED_BAND);
  h.debug.setLives(START_LIVES);
  h.debug.setShipContact(true);

  assertEqual(
    h.snapshot().ship.band,
    POSED_BAND,
    "precondition: the ship holds the posed band before it is hit, which is " +
      "the band the respawn has to carry across (specs/instrumentation.md)",
  );

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_FRAMES,
  });
  assertEqual(
    opened.hit,
    true,
    `precondition: losing a life to a ${BULLET_BAND} bullet dropped ` +
      `${DROP_ABOVE} units above the ship putting the wave into its ready ` +
      `phase, inside ${FALL_FRAMES} frames (${seconds(FALL_FRAMES)} s) at ` +
      `ENEMY_BULLET_SPEED ${ENEMY_BULLET_SPEED} (specs/progression.md) — ` +
      "without the hold there is no respawn to read",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_FRAMES,
  });
  captureStill(h, "band");
  assertEqual(
    returned.hit,
    true,
    "precondition: the wave returning to its live phase when the hold ended, " +
      "inside twice READY_HOLD (specs/progression.md) — the ship reappears at " +
      "that moment",
  );

  assertEqual(
    returned.snapshot.ship.band,
    POSED_BAND,
    `the band the ship holds on the first frame after the hold, from the ` +
      `${POSED_BAND} it was tuned to when it died — it reappears holding the ` +
      `band it held (specs/progression.md)`,
  );
});
