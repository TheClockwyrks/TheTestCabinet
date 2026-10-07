// Wick — halo/pulse-hits-overlapping: a pulse hits every enemy whose circle
// overlaps the aura, and no enemy whose circle does not.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): on a pulse
// "every enemy whose circle overlaps the aura takes `damage`"; ("Shapes and
// overlap") "Two circles overlap when the distance between their centers is
// less than the sum of their radii", and "An enemy is a circle of its own
// radius". Row 1 of `HALO_LEVELS` carries radius `80` and damage `3`, a moth's
// radius is `10` and its hp `5` at a run clock of `0` (`specs/enemies.md`), so
// the overlap distance is `90`: a moth at `85` reads `2` on the pulse tick and
// a moth at `95` reads `5`.
//
// THE POSE. An isolated night with one moth `85` along `+x` and one `95` along
// `−x` from the lamplighter, then Halo held at level 1 and its first tick run
// through the shared `fireWeapon` (held, due, `weaponFire` on, one tick):
// "Halo pulses on the first `playing` tick it is held". `enemyMotion` and
// `enemyContact` stay held, so each moth stands where it was posed, and each
// stands far outside the `12 + 10` of contact.
//
// TOLERANCE. `FLOAT_TOL` on each moth's hp: `5 − 3 × 1` and `5` are exact,
// and a build is free to multiply in any order. The distances are posed `5`
// units either side of the boundary, far above any drift in a build's
// distance arithmetic.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { HALO } from "./stage";

/** The level whose row is held: radius `80`, damage `3`. */
const LEVEL = 1;

/** Halo's level-1 row. */
const ROW = weaponRow(HALO, LEVEL);

/** A moth's table hp, `5`, and radius, `10`. */
const MOTH = ENEMIES.moth;

/** How far past the overlap distance either moth is posed. */
const MARGIN = 5;

/** The distance below which a moth's circle overlaps the aura: `80 + 10`. */
const OVERLAP = ROW.radius! + MOTH.radius;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("damages a moth at 85 on the pulse and leaves a moth at 95 untouched, against a radius of 80", async () => {
  await isolate(h);
  const inside = await placeEnemyNear(h, "moth", OVERLAP - MARGIN, 0);
  const outside = await placeEnemyNear(h, "moth", -(OVERLAP + MARGIN), 0);
  assertEqual(inside.hp, MOTH.hp, "the overlapping moth's hp as posed");
  assertEqual(outside.hp, MOTH.hp, "the clear moth's hp as posed");

  const firing = await fireWeapon(h, HALO, LEVEL);
  await captureStill(h, "overlap");

  assertNear(
    mustEnemy(firing.after, inside.id).hp,
    MOTH.hp - ROW.damage,
    FLOAT_TOL,
    `the moth at ${OVERLAP - MARGIN} on the pulse tick`,
  );
  assertNear(
    mustEnemy(firing.after, outside.id).hp,
    MOTH.hp,
    FLOAT_TOL,
    `the moth at ${OVERLAP + MARGIN} on the pulse tick`,
  );
});
