// progression/game-over-at-zero — losing the last life ends the run.
//
// specs/progression.md: "Losing a life with no life left ends the run and opens
// the game-over screen." Its sibling rule is what makes this point distinct —
// "Losing a life with lives to spare puts the live wave into its `ready` phase" —
// so a run's LAST life takes a different road from every other one, and this
// check reads which road the build took.
//
// THE DISTINGUISHING POSE IS THE LIFE COUNT. `startPosed` leaves the run on
// `START_LIVES` (`3`), which is where `progression.ready-hold` reads the hold;
// one life is posed here instead, so the very same event — one opposite-band
// enemy bullet reaching the hull — has to end the run rather than hold the wave.
// A build that always holds reads `inWave`/`ready` and fails here; a build that
// always ends the run fails `progression.ready-hold` instead. The pair grades the
// two directions apart.
//
// THE LOSS IS REAL, NOT POSED. Nothing here writes `screen`, `phase` or `lives`
// once the run is posed: the bullet falls and the build's own contact rules
// decide what the last life opens. `setShipContact(true)` puts back the one world
// gate `startPosed` shuts.
//
// THE FIELD HOLDS NOTHING ELSE — no drone, no second bullet — and the wave's own
// entry and dive launching are shut, so nothing but the bullet under test can
// end the run inside this window.
//
// WHAT THIS DOES NOT DECIDE. What the game-over screen draws
// (`progression.game-over-reports-run`'s and `screens`'s), nor what its two menu
// items do.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  SHIP_HALF,
  bulletSpeedScale,
} from "../../src/constants";
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

/** The band the ship holds, and the opposite one the bullet carries. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/**
 * The lives the run is posed with: one, the last.
 *
 * The whole of what separates this point from `progression.ready-hold`, which
 * runs the identical event on `START_LIVES` (`3`).
 */
const LAST_LIFE = 1;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to end the run.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus four frames: two for the frame the bullet is placed on, and
 * two more so a build that opens the screen in the update after the one that
 * resolved the contact is not mistaken for one that never opens it.
 */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the game-over screen when the last life is lost", async () => {
  startPosed(h);
  // The distinguishing pose: one life left, so this loss is the run's last.
  h.debug.setLives(LAST_LIFE);
  h.debug.setShipBand(SHIP_BAND);
  // The one world gate this point's requirement rests on.
  h.debug.setShipContact(true);

  const posed = h.snapshot();
  assertEqual(posed.lives, LAST_LIFE, "the lives the run was posed with");
  assertEqual(posed.screen, "inWave", "the screen the run was posed on");

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  const over = await h.until((s) => s.screen === "gameOver", {
    maxFrames: FALL_TICKS,
  });
  captureStill(h, "over");

  assertEqual(
    over.hit,
    true,
    `losing the run's last life to a ${BULLET_BAND} bullet dropped ` +
      `${DROP_ABOVE} units above a ${SHIP_BAND} ship opening the game-over ` +
      `screen inside ${FALL_TICKS} frames (${seconds(FALL_TICKS)} s) — at ` +
      `ENEMY_BULLET_SPEED ${ENEMY_BULLET_SPEED} the ${DROP_ABOVE - TOUCHING} ` +
      "units to the contact take " +
      `${seconds(ticksFor((DROP_ABOVE - TOUCHING) / FALL_SPEED))} s. The ` +
      `screen reached instead was "${over.snapshot.screen}"/` +
      `"${over.snapshot.phase}", on ${over.snapshot.lives} lives — ` +
      '"inWave"/"ready" is a build that holds for the ready beat whatever the ' +
      "count says (specs/progression.md)",
  );
});
