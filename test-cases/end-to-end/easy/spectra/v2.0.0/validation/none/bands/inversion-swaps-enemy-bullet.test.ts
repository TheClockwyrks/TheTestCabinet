// bands/inversion-swaps-enemy-bullet — an inversion swaps an enemy bullet too.
//
// specs/bands.md lists the third swap as "A spectral inversion is active and the
// entity is a drone or an enemy bullet", and specs/swarm.md says why it must
// reach the bullet as well as its firer: "A spectral inversion swaps a drone and
// its bullets alike, so a bullet always reads as the band its firer reads as." A
// build that inverted only the drones would leave a diver shooting bullets the
// ship's shield now filters the wrong way.
//
// One enemy bullet is placed in open field with `addEnemyBullet`, well away from
// the ship and from anything else — the field is otherwise empty and the ship's
// contact gate is shut — so the only thing that can move its reading is the
// inversion. The pair is read: the stored band still cyan, the effective band
// magenta, so a build that rewrote the stored field fails as loudly as one that
// did not swap at all.
//
// The player's own bullets are the exception the sibling
// `bands/inversion-spares-player-bullet` reads, from the same posed inversion.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { INVERSION_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  lastBullet,
  requireBullet,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the enemy bullet is placed: mid-field, off the ship's lane centre.
 *
 * It falls at 3.2 units per frame of the harness's 100 Hz clock, so over the one
 * frame this check runs it stays where it was put, hundreds of units clear of the
 * ship at `SHIP_Y` (600).
 */
const AT = { x: 400, y: 300 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reads a stored-cyan enemy bullet as magenta while an inversion runs", async () => {
  await startPosed(harness);
  await harness.debug.addEnemyBullet(AT.x, AT.y, "cyan");
  const added = lastBullet(await harness.snapshot());
  if (added === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addEnemyBullet",
    );
  }
  await harness.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field. It costs the
  // inversion 0.01 s of its 5.
  await harness.advance(1);

  const posed = await harness.snapshot();
  await captureStill(harness, "swapped");

  assertEqual(
    posed.inversionActive,
    true,
    "an inversion running over the posed bullet",
  );
  const bullet = requireBullet(
    posed,
    added.id,
    "the stored-cyan enemy bullet under an inversion",
  );
  assertEqual(bullet.friendly, false, "the bullet posed as an enemy's");
  assertEqual(
    bullet.band,
    "cyan",
    "the bullet's stored band, which an inversion never changes (specs/bands.md)",
  );
  assertEqual(
    bullet.effectiveBand,
    "magenta",
    "the band a stored-cyan enemy bullet reads as under an inversion (specs/bands.md)",
  );
});
