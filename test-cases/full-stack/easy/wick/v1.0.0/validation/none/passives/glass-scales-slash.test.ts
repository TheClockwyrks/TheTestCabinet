// Wick — passives/glass-scales-slash: `areaMul` scales a slash's width and
// height.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`), and ("Area") "`areaMul` scales every length a weapon's table or stat
// row gives for the shape it hits with", the table naming "Taper, Pyre | slash
// `width`, slash `height`". Row 1 of `TAPER_LEVELS` (`specs/weapons.md`)
// carries width `120` and height `40`, so with Glass at level 2 the slash reads
// `144 × 48`. `specs/instrumentation.md` ("Snapshot shape") has "`width` and
// `height` appear on a slash alone".
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and Taper
// held at level 1 and fired by one tick. Taper "needs no target", so no enemy
// is posed and the reading is the rectangle the firing tick created. Every
// other faculty stays held, so nothing else fires and nothing moves.
//
// TOLERANCE. `FLOAT_TOL` on each length, a table figure times exactly `1.2`.
// The unscaled `120 × 40` is tens of units away on both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Taper level fired: table width `120`, height `40`. */
const LEVEL = 1;

/** The scale every length the row gives passes through. */
const SCALE = areaMul({ glass: GLASS_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads width 144 and height 48 on a level-1 slash with Glass 2 held", async () => {
  const row = weaponRow("taper", LEVEL);
  await isolate(h);
  await h.debug.setFacing("right");
  await holdPassive(h, "glass", GLASS_LEVEL);

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "slash");

  const slashes = firing.zones.filter((zone) => zone.weapon === "taper");
  assertEqual(slashes.length, 1, "Taper slashes the firing tick created");
  assertNear(
    slashes[0]!.width ?? NaN,
    (row.width ?? NaN) * SCALE,
    FLOAT_TOL,
    "the slash's width with Glass 2 held",
  );
  assertNear(
    slashes[0]!.height ?? NaN,
    (row.height ?? NaN) * SCALE,
    FLOAT_TOL,
    "the slash's height with Glass 2 held",
  );
});
