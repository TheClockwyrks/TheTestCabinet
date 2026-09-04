// bands/inversion-spares-player-bullet — the player's bullets are never inverted.
//
// specs/bands.md states the exception twice: once in the swap list, whose third
// entry holds only when "the entity is a drone or an enemy bullet", and once
// outright — "The ship's band and the player's bullets are never swapped. A player
// bullet's effective band always equals its stored band."
// specs/instrumentation.md repeats it for the snapshot: "A player bullet's
// `effectiveBand` therefore always equals its `band`."
//
// THIS IS THE WRONG-MODEL READING of the whole inversion rule. A build that
// inverts every entity on the field passes `bands.inversion-swaps-drone` and
// `bands.inversion-swaps-enemy-bullet` and fails only here — and it plays wrongly
// in exactly the way that matters, since under an inversion the player would have
// to aim at the drone's stored band twice over.
//
// ONE OF THE PLAYER'S BULLETS IN OPEN FIELD is the whole world: the rosters are
// empty, the three world gates are shut, and the bullet is placed off the ship's
// lane with nothing above it, so the single frame that runs resolves nothing
// against it and the inversion is the only thing that could have moved the
// reading. The pair is read, stored band and effective band together.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  posePlayerBullet,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the bullet is placed, in logical units: mid-field, off the ship's lane
 * centre.
 *
 * It climbs at 7.6 units per frame of the harness's 100 Hz clock, so over the one
 * frame this check runs it stays in open field, far below `FIELD_TOP` (`64`,
 * specs/field.md) where a player bullet would leave the roster.
 */
const AT_X = 400;
const AT_Y = 400;

/** The band the bullet carries, stored and effective alike. */
const STORED = "cyan" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one of the player's bullets on its stored band under an inversion", async () => {
  startPosed(h);
  const id = posePlayerBullet(h, AT_X, AT_Y, STORED);
  h.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field. It costs the
  // inversion 0.01 s of its 5.
  await h.advance(1);

  const posed = h.snapshot();
  captureStill(h, "kept");

  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the posed bullet, ${INVERSION_TIME} s having ` +
      `been set on it (specs/instrumentation.md)`,
  );
  const bullet = bulletById(posed, id);
  if (bullet === undefined) {
    fail(
      "the posed player bullet still on the bullet roster (specs/instrumentation.md)",
      "no bullet carries the id addPlayerBullet appended",
    );
  }
  assertEqual(bullet.friendly, true, "the bullet posed as the player's");
  assertEqual(bullet.band, STORED, "the bullet's stored band");
  assertEqual(
    bullet.effectiveBand,
    STORED,
    `the band one of the player's bullets reads as under an inversion: its ` +
      `stored band, the player's shots never being swapped (specs/bands.md)`,
  );
});
