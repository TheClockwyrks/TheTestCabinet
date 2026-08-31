// progression/bullet-costs-life — an opposite-band enemy bullet costs ONE life.
//
// `specs/progression.md` prices it in its table: "An enemy bullet of the band
// opposite the ship's reaches the ship | One life", and fixes the arithmetic in
// the sentence under it — "One event costs exactly one life, whatever else is on
// the field at that instant."
//
// SO THIS ITEM IS ABOUT THE PRICE, not about which bullets are lethal
// (`bands/shield-opposite-lethal`'s) and not about what the loss opens
// (`progression/ready-hold`'s). It reads the count on the frame the count moved,
// and requires exactly one off it. Two wrong models read different numbers there:
// a build that charges once per SUB-STEP pays twice, because a frame of this
// harness's 100 Hz clock (`0.01 s`) divides into two sub-steps of at most
// `SUBSTEP_MAX` (`1/120 s`, `specs/simulation.md`); a build that never charges at
// all never moves the count and fails on the sweep.
//
// THE HIT IS REAL, NOT POSED. Nothing here writes `lives`. One enemy bullet of
// the band `specs/bands.md` says the hull does NOT take is placed above the ship
// and allowed to fall, and the build's own contact and band rules decide the
// rest. `setShipContact(true)` puts back the one world gate `startPosed` shuts,
// because a contact test IS this item's requirement.
//
// THE FIELD HOLDS NOTHING ELSE — no drone, no second bullet, no burst, and the
// wave's own entry and dive launching are shut — so the only thing that can move
// the life count in this window is the bullet under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  START_LIVES,
  bulletSpeedScale,
  opposite,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * The hull's contact reach against an enemy bullet is `SHIP_HALF` (`15`) plus
 * `ENEMY_BULLET_HALF` (`8`) — 23 units of centre separation — so 120 starts the
 * bullet better than five times clear of it and the contact is one the fall
 * produced rather than one the placement staged.
 */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames of slack for the frame the bullet is placed on.
 * Contact lands sooner than that, since the two half-extents meet before the
 * centres do. The sweep therefore ends with the bullet no lower than
 * `y = 608`, above `FIELD_BOTTOM` (`656`), so nothing in this window can leave
 * the field.
 */
const FALL_FRAMES = framesFor(DROP_ABOVE / FALL_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes exactly one life when an opposite-band bullet reaches the ship", async () => {
  await startPosed(h);
  // The one world gate this item's requirement IS: without it the hull runs no
  // contact test and nothing can ever cost a life.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const band = opposite(posed.ship.band);
  await poseEnemyBulletAbove(h, band, DROP_ABOVE);

  // Sampled every frame, so what comes back is the state on the FIRST frame the
  // count moved — the frame the one event resolved on, before a hold or a second
  // contact could reach it.
  const struck = await h.until((s) => s.lives !== START_LIVES, {
    maxFrames: FALL_FRAMES,
  });
  await captureStill(h, "cost");

  assertEqual(
    struck.hit,
    true,
    `the ${band} bullet dropped ${String(DROP_ABOVE)} units above the hull, ` +
      "opposite the band the ship holds, costing a life inside the " +
      `${String(FALL_FRAMES)} frames its fall takes (specs/progression.md)`,
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    `the lives left on the frame the count moved, from ${String(START_LIVES)} — ` +
      "one event costs exactly one life (specs/progression.md)",
  );
});
