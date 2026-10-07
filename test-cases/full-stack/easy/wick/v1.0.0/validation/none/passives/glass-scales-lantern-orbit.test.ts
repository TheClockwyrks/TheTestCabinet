// Wick — passives/glass-scales-lantern-orbit: `areaMul` scales a lantern set's
// orbit.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table
// names "Lantern, Chandelier | `orbit`, lantern `radius`" among the lengths
// `areaMul` scales, over "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with
// `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of `LANTERN_LEVELS`
// (`specs/weapons.md`) carries orbit `90`, so with Glass at level 2 the
// lantern rides a circle of radius `108`. ("Lantern") "On firing, `amount`
// lanterns appear on a circle of radius `orbit` around the player's center",
// so the distance from the lamplighter's center to the lantern's is the orbit.
// The other length the same table row covers is `passives/glass-scales-
// lantern-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and
// Lantern held at level 1 and fired by one tick. Lantern "needs no target", so
// no enemy is posed. Every other faculty stays held: `effectMotion` off keeps
// the lantern at the angle it was created at, and the lamplighter stands at
// the origin, so the distance read is the circle the set was created on.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on the orbit, a distance a build computed
// from a cosine and a sine. The unscaled `90` is units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { POSITION_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { orbitOf } from "./stage";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Lantern level fired: table orbit `90`, radius `14`, amount `1`. */
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

it("reads orbit 108 for a level-1 lantern with Glass 2 held", async () => {
  const row = weaponRow("lantern", LEVEL);
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);

  const firing = await fireWeapon(h, "lantern", LEVEL);
  await captureStill(h, "lantern");

  const lanterns = firing.zones.filter((zone) => zone.weapon === "lantern");
  assertEqual(lanterns.length, 1, "lanterns the firing tick created");
  assertNear(
    orbitOf(firing.after, lanterns[0]!),
    (row.orbit ?? NaN) * SCALE,
    POSITION_TOL,
    "the radius of the circle the lantern rides, with Glass 2 held",
  );
});
