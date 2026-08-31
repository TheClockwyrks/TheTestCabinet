// bands/inversion-spares-player-bullet — the player's bullets are never inverted.
//
// specs/bands.md states the exception twice, once in the swap list — the third
// swap holds only when "the entity is a drone or an enemy bullet" — and once
// outright: "The ship's band and the player's bullets are never swapped. A player
// bullet's effective band always equals its stored band." specs/instrumentation.md
// repeats it for the snapshot: "A player bullet's `effectiveBand` therefore
// always equals its `band`."
//
// This is the wrong-model reading of the whole inversion rule. A build that
// inverts every entity on the field passes `bands/inversion-swaps-drone` and
// `bands/inversion-swaps-enemy-bullet` and fails here, and it plays wrongly in
// exactly the way that matters: under an inversion the player would have to aim
// at the drone's stored band twice over.
//
// One of the player's bullets is placed in open field with `addPlayerBullet`,
// with an inversion posed over it and nothing else on the field, and the pair is
// read: the stored band cyan and the effective band cyan with it.

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
 * Where the bullet is placed: mid-field, off the ship's lane centre.
 *
 * It climbs at 7.6 units per frame of the harness's 100 Hz clock, so over the one
 * frame this check runs it stays in open field, well below `FIELD_TOP` (64).
 */
const AT = { x: 400, y: 400 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves one of the player's bullets on its stored band under an inversion", async () => {
  await startPosed(harness);
  await harness.debug.addPlayerBullet(AT.x, AT.y, "cyan");
  const added = lastBullet(await harness.snapshot());
  if (added === undefined) {
    fail(
      "addPlayerBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addPlayerBullet",
    );
  }
  await harness.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field. It costs the
  // inversion 0.01 s of its 5.
  await harness.advance(1);

  const posed = await harness.snapshot();
  await captureStill(harness, "kept");

  assertEqual(
    posed.inversionActive,
    true,
    "an inversion running over the posed bullet",
  );
  const bullet = requireBullet(
    posed,
    added.id,
    "the player's bullet under an inversion",
  );
  assertEqual(bullet.friendly, true, "the bullet posed as the player's");
  assertEqual(bullet.band, "cyan", "the bullet's stored band");
  assertEqual(
    bullet.effectiveBand,
    "cyan",
    "the band one of the player's bullets reads as under an inversion: its stored band (specs/bands.md)",
  );
});
