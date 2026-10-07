// Wick — passives/glass-scales-lantern-radius: `areaMul` scales a lantern
// set's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table
// names "Lantern, Chandelier | `orbit`, lantern `radius`" among the lengths
// `areaMul` scales, over "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with
// `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of `LANTERN_LEVELS`
// (`specs/weapons.md`) carries radius `14`, so with Glass at level 2 the
// lantern reads `16.8`. The other length the same table row covers is
// `passives/glass-scales-lantern-orbit`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and
// Lantern held at level 1 and fired by one tick. Lantern "needs no target", so
// no enemy is posed. Every other faculty stays held: `effectMotion` off keeps
// the lantern at the angle it was created at, and the lamplighter stands at
// the origin, so the distance read is the circle the set was created on.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `14` is units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { LANTERN_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** Lantern's level-1 row, whose `orbit` is `90` and `radius` `14`. */
const ROW = LANTERN_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Lantern set's lantern radius 16.8 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["lantern", 1]],
  });
  captureStill(h, "lantern");

  const lanterns = firing.zones.filter((zone) => zone.kind === "lantern");
  assertEqual(
    lanterns.length,
    ROW.amount,
    "the lanterns the firing tick created (specs/weapons.md, Lantern)",
  );
  assertNear(
    lanterns[0].radius,
    ROW.radius * areaMul(GLASS),
    REAL_EPS,
    "the lantern's radius under Glass 2 (specs/passives.md, Area)",
  );
});
