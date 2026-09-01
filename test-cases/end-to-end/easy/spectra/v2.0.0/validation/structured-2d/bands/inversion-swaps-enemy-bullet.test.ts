// bands/inversion-swaps-enemy-bullet — an inversion swaps an enemy bullet too.
//
// specs/bands.md lists the third swap as "A spectral inversion is active and the
// entity is a drone or an enemy bullet", and specs/swarm.md says why it must reach
// the bullet as well as its firer: "A spectral inversion swaps a drone and its
// bullets alike, so a bullet always reads as the band its firer reads as." A build
// that inverted only the drones would leave a diver shooting bullets the ship's
// shield now filters the wrong way.
//
// ONE ENEMY BULLET IN OPEN FIELD is the whole world: `startPosed` empties the
// rosters and shuts the three world gates, and the bullet is placed off the ship's
// lane and hundreds of units above it, so nothing but the inversion can move its
// reading and nothing resolves against it in the single frame that runs.
//
// THE READING IS A PAIR — the stored band still cyan, the effective band magenta —
// so a build that rewrote the stored field fails as loudly as one that did not
// swap at all. `friendly` is read too, because the rule turns on the bullet being
// an enemy's: the player's is the exception the sibling
// `bands.inversion-spares-player-bullet` reads.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  poseEnemyBullet,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the enemy bullet is placed, in logical units: mid-field, off the ship's
 * lane centre.
 *
 * It falls at 3.2 units per frame of the harness's 100 Hz clock, so over the one
 * frame this check runs it stays where it was put, well inside the play field and
 * hundreds of units clear of the ship at `SHIP_Y` (`600`).
 */
const AT_X = 400;
const AT_Y = 320;

/** The bullet's stored band, and the band it must read as under the inversion. */
const STORED = "cyan" as const;
const SWAPPED = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan enemy bullet as magenta while an inversion runs", async () => {
  startPosed(h);
  const id = poseEnemyBullet(h, AT_X, AT_Y, STORED);
  h.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field. It costs the
  // inversion 0.01 s of its 5.
  await h.advance(1);

  const posed = h.snapshot();
  captureStill(h, "swapped");

  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the posed bullet, ${INVERSION_TIME} s having ` +
      `been set on it (specs/instrumentation.md)`,
  );
  const bullet = bulletById(posed, id);
  if (bullet === undefined) {
    fail(
      "the posed enemy bullet still on the bullet roster (specs/instrumentation.md)",
      "no bullet carries the id addEnemyBullet appended",
    );
  }
  assertEqual(bullet.friendly, false, "the bullet posed as an enemy's");
  assertEqual(
    bullet.band,
    STORED,
    "the bullet's stored band, which an inversion never changes (specs/bands.md)",
  );
  assertEqual(
    bullet.effectiveBand,
    SWAPPED,
    `the band a stored-${STORED} enemy bullet reads as under an inversion ` +
      `(specs/bands.md, specs/swarm.md)`,
  );
});
