// progression/game-over-at-zero — losing the last life ends the run.
//
// `specs/progression.md`: "Losing a life with no life left ends the run and opens
// the game-over screen." Its sibling rule is the one that makes this item
// distinct — "Losing a life with lives to spare puts the live wave into its
// `ready` phase" — so a run's LAST life takes a different road from every other
// one, and this check reads which road the build took.
//
// THE DISTINGUISHING POSE IS THE LIFE COUNT. `startPosed` leaves the run on
// `START_LIVES` (`3`), which is where `progression/ready-hold` reads the hold; one
// life is posed here instead, so the very same event — one opposite-band enemy
// bullet reaching the hull — has to end the run rather than hold the wave. A
// build that always holds reads `inWave`/`ready` and fails; a build that always
// ends the run fails `progression/ready-hold` instead. The pair grades the two
// directions apart.
//
// THE LOSS IS REAL, NOT POSED. Nothing here writes `screen`, `phase` or `lives`
// once the run is posed: the bullet falls and the build's own contact rules
// decide what the last life opens. `setShipContact(true)` puts back the one world
// gate `startPosed` shuts.
//
// WHAT THIS DOES NOT DECIDE. What the game-over screen draws
// (`progression/game-over-reports-run`'s and `screens/`'s), nor what its two menu
// items do.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMY_BULLET_SPEED, bulletSpeedScale, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/**
 * The lives the run is posed with: one, the last.
 *
 * The whole of what separates this item from `progression/ready-hold`, which runs
 * the identical event on `START_LIVES` (`3`).
 */
const LAST_LIFE = 1;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to end the run.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus four frames: two for the frame the bullet is placed on, and
 * two more so a build that opens the screen in the update after the one that
 * resolved the contact is not mistaken for one that never opens it.
 */
const FALL_FRAMES = framesFor(DROP_ABOVE / FALL_SPEED) + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the game-over screen when the last life is lost", async () => {
  await startPosed(h);
  // The distinguishing pose: one life left, so this loss is the run's last.
  await h.debug.setLives(LAST_LIFE);
  // The one world gate this item's requirement rests on.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.lives, LAST_LIFE, "the lives the run was posed with");
  assertEqual(posed.screen, "inWave", "the screen the run was posed on");

  const band = opposite(posed.ship.band);
  await poseEnemyBulletAbove(h, band, DROP_ABOVE);

  const over = await h.until((s) => s.screen === "gameOver", {
    maxFrames: FALL_FRAMES,
  });
  await captureStill(h, "over");

  assertEqual(
    over.hit,
    true,
    `losing the run's last life to the ${band} bullet opening the game-over ` +
      `screen, inside the ${String(FALL_FRAMES)} frames the fall takes — ` +
      `the screen reached instead was "${over.snapshot.screen}"/` +
      `"${over.snapshot.phase}" (specs/progression.md)`,
  );
});
