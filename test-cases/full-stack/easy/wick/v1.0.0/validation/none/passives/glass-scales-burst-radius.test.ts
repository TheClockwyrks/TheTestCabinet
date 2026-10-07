// Wick — passives/glass-scales-burst-radius: `areaMul` scales the burst's
// radius, and the scaled radius is what the burst reaches.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table names
// "Flare | burst `radius`" among the lengths `areaMul` scales, over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`). Row 1 of `FLARE_LEVELS` (`specs/weapons.md`) carries radius `640`
// and damage `100`, so with Glass at level 2 the burst reads `768`;
// `specs/instrumentation.md` ("Snapshot shape") has "a burst's `radius` is its
// Flare `radius`". ("Flare") "On firing, every enemy within `radius` of the
// player's center takes `damage` on that tick", and ("Shapes and overlap") "An
// enemy is within `d` of a point when the distance from that point to the
// enemy's center is at most `d`", so a moth `TARGET` (`700`) units out is
// inside the scaled `768` and outside the unscaled `640`. A moth's `hp` is `5`
// (`specs/enemies.md`), which a burst of `100` takes below `0`, and "On any
// tick that leaves `hp` at or below `0` the enemy dies on that tick: it is
// removed".
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, one moth
// posed `700` units along `+x`, and Flare held at level 1 and fired by one
// tick. Flare "fires whether or not any enemy exists" and "amount is ignored",
// so the moth is there only to be reached. Every other faculty stays held, so
// the moth stands where it was posed and nothing else fires.
//
// TOLERANCE. `FLOAT_TOL` on the burst's radius, a table figure times exactly
// `1.2`; whether the moth is still live is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  fireWeapon,
  holdPassive,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Flare level fired: table radius `640`, damage `100`. */
const LEVEL = 1;

/** Where the moth stands: inside 768, outside 640. */
const TARGET = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 768 on a level-1 burst with Glass 2 held and reaches a moth 700 units out", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  const moth = await placeEnemyNear(h, "moth", TARGET, 0);

  const firing = await fireWeapon(h, "flare", LEVEL);
  await captureStill(h, "burst");

  const bursts = firing.zones.filter((zone) => zone.weapon === "flare");
  assertEqual(bursts.length, 1, "bursts the firing tick created");
  assertNear(
    bursts[0]!.radius,
    (weaponRow("flare", LEVEL).radius ?? NaN) * areaMul({ glass: GLASS_LEVEL }),
    FLOAT_TOL,
    "the burst's radius with Glass 2 held",
  );
  assertUndefined(
    enemyById(firing.after, moth.id),
    `the moth ${TARGET} units out after the burst`,
  );
});
