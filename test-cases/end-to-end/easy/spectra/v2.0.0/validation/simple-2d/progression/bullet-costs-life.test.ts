// progression/bullet-costs-life — an opposite-band enemy bullet costs ONE life.
//
// specs/progression.md prices it in its table: "An enemy bullet of the band
// opposite the ship's reaches the ship | One life", and fixes the arithmetic in
// the sentence under it — "One event costs exactly one life, whatever else is on
// the field at that instant."
//
// SO THIS POINT IS ABOUT THE PRICE, not about which bullets are lethal
// (`bands.shield-opposite-lethal`'s) and not about what the loss opens
// (`progression.ready-hold`'s). The count is read on the FIRST FRAME IT MOVED,
// sampled one frame at a time, and exactly one is required off it. Two wrong
// models read different numbers there: a build that resolves the same contact
// twice in the frame it lands — a contact pass either side of the motion step, a
// bullet charged for and left in the roster — reads two off, and a build that
// never charges at all never moves the count and fails the sweep.
//
// THE HIT IS REAL, NOT POSED. Nothing here writes `lives`. One enemy bullet of
// the band specs/bands.md says the hull does NOT take is placed above the ship
// and allowed to fall, and the build's own contact and band rules decide the
// rest. `setShipContact(true)` puts back the one world gate `startPosed` shuts,
// because a contact test IS this point's requirement: with it shut no bullet of
// any band could cost anything and the sweep would fail on every build.
//
// LIVES ARE POSED WITH SPARE — `startPosed` leaves them at `START_LIVES` (`3`) —
// so the contact reads as a decrement rather than as the end of the run, which is
// `progression.game-over-at-zero`'s.
//
// THE FIELD HOLDS NOTHING ELSE: no drone, no second bullet, no burst, and the
// wave's own entry and dive launching are shut, so the only thing that can move
// the life count in this window is the bullet under test.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
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
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * The hull's contact reach against an enemy bullet is `SHIP_HALF` (`15`) plus
 * `ENEMY_BULLET_HALF` (`8`), 23 units of centre separation, so 120 starts the
 * bullet better than five times clear of it and the contact is one the fall
 * produced rather than one the placement staged.
 */
const DROP_ABOVE = 120;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames of slack for the frame the bullet is placed on.
 * Contact lands sooner than that, at `DROP_ABOVE - TOUCHING` (`97`) units, since
 * the two half-extents meet before the centres do. The sweep therefore ends with
 * the bullet no lower than `y = 605`, above `FIELD_BOTTOM` (`656`), so nothing in
 * this window can leave the field.
 */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/** Lives before the contact, and the one specs/progression.md leaves after it. */
const LIVES_BEFORE = START_LIVES;
const LIVES_AFTER = LIVES_BEFORE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly one life when an opposite-band bullet reaches the ship", async () => {
  startPosed(h);
  // The one world gate this point's requirement IS.
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(LIVES_BEFORE);
  const posed = h.snapshot();
  assertEqual(posed.lives, LIVES_BEFORE, "the lives the run was posed with");
  assertEqual(
    posed.ship.band,
    SHIP_BAND,
    "the band the ship was posed holding, opposite the bullet's",
  );

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  // Sampled every frame, so what comes back is the state on the FIRST frame the
  // count moved — the frame the one event resolved on, before the ready hold or
  // a second contact could reach it.
  const struck = await h.until((s) => s.lives !== LIVES_BEFORE, {
    maxFrames: FALL_TICKS,
  });
  captureStill(h, "cost");

  assertEqual(
    struck.hit,
    true,
    `a ${BULLET_BAND} enemy bullet dropped ${DROP_ABOVE} units above a ` +
      `${SHIP_BAND} ship moving the life count inside ${FALL_TICKS} frames ` +
      `(${seconds(FALL_TICKS)} s) — at ENEMY_BULLET_SPEED ${ENEMY_BULLET_SPEED} ` +
      `the ${DROP_ABOVE - TOUCHING} units to the contact take ` +
      `${seconds(ticksFor((DROP_ABOVE - TOUCHING) / FALL_SPEED))} s, and the ` +
      `bullet ends the sweep above FIELD_BOTTOM ${FIELD_BOTTOM} so it cannot ` +
      `have left the field (specs/progression.md, SHIP_Y ${SHIP_Y})`,
  );
  assertEqual(
    struck.snapshot.lives,
    LIVES_AFTER,
    `the lives on the frame the count moved, from ${LIVES_BEFORE} — ` +
      "specs/progression.md: one event costs exactly one life, whatever else " +
      `is on the field at that instant. ${LIVES_BEFORE - 2} is one bullet ` +
      "charged twice in the frame it landed",
  );
});
