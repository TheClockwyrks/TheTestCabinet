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
import { LANTERN_LEVELS, MOTION_EPS, areaMul } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
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

it("gives a level-1 Lantern set's lantern orbit 108 under Glass 2", async () => {
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
    distance(lanterns[0], firing.after.run.player),
    ROW.orbit * areaMul(GLASS),
    MOTION_EPS,
    "the lantern's distance from the lamplighter's center under Glass 2 (specs/passives.md, Area)",
  );
});
