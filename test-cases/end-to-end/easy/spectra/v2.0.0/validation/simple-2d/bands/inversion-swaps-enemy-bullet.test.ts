// bands/inversion-swaps-enemy-bullet — an inversion swaps an enemy bullet's band.
//
// specs/bands.md, "Effective band": a stored band is taken as its opposite once
// for each swap that holds, and one of them is "A spectral inversion is active
// and the entity is a drone or an enemy bullet". "The spectral inversion" states
// it again — "every drone and every enemy bullet reads as the opposite of its
// stored band". specs/instrumentation.md reports a bullet's `band` and its
// `effectiveBand` separately, and `friendly` false is what makes this one an
// enemy's.
//
// THE ENEMY BULLET IS PLACED RATHER THAN FIRED. `addEnemyBullet` puts one in
// flight carrying the band the caller names (specs/instrumentation.md), so the
// stored band under test is the one this check chose and no drone's fire, no
// dive and no aim enters the reading. `startPosed` shuts the ship's contact test,
// so the bullet falls without anything resolving against it.
//
// IT IS PLACED HIGH IN THE FIELD, so the single frame that runs cannot carry it
// anywhere near the ship's lane or the edge that removes it.
//
// ONE FRAME RUNS, so the reading is taken off a game that has stepped rather than
// off the pose itself, and so the still has a rendered field in it.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  bulletOf,
  captureStill,
  createHarness,
  lastBullet,
  startPosed,
  type Harness,
} from "../harness";

/** Where the bullet is placed: high in the play field (specs/field.md). */
const BULLET_X = LANE_CENTER;
const BULLET_Y = 200;

/** The band the bullet stores, and the one an inversion makes it read as. */
const STORED_BAND = "cyan" as const;
const SWAPPED_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan enemy bullet as magenta while an inversion runs", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  h.debug.addEnemyBullet(BULLET_X, BULLET_Y, STORED_BAND);
  const bulletId = lastBullet(h.snapshot()).id;

  await h.advance(1);
  captureStill(h, "swapped");

  const posed = h.snapshot();
  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the posed bullet after setInversion ` +
      `(${INVERSION_TIME} s) — without one the swap below would be no swap ` +
      "at all",
  );

  const bullet = bulletOf(posed, bulletId);
  assertEqual(
    bullet.friendly,
    false,
    "the bullet posed as an enemy's, which is what makes it one of the " +
      "bullets specs/bands.md swaps",
  );
  assertEqual(
    bullet.band,
    STORED_BAND,
    "the bullet's STORED band, which specs/bands.md says an inversion never " +
      "changes: it swaps how a band READS, not what is stored",
  );
  assertEqual(
    bullet.effectiveBand,
    SWAPPED_BAND,
    `the effective band of an enemy bullet storing ${STORED_BAND} with an ` +
      `inversion of ${INVERSION_TIME} s posed — specs/bands.md: while an ` +
      "inversion is active, every enemy bullet reads as the opposite of its " +
      "stored band",
  );
});
