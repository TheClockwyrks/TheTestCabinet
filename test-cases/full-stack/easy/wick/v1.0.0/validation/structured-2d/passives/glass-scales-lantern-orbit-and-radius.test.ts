// passives/glass-scales-lantern-orbit-and-radius — Glass scales a lantern
// set's orbit and each lantern's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Lantern, Chandelier | `orbit`, lantern `radius`" over "The scaled length is
// the table value times `areaMul`", and `areaMul` is `1 + 0.1 × glass`, so
// `1.2` at Glass 2. Lantern's level-1 row gives `orbit` `90` and `radius` `14`
// (`specs/weapons.md`, Lantern), so the lantern reads radius `16.8` on a
// circle of radius `108`.
//
// WHERE THE LANTERN STANDS. `specs/weapons.md`, Lantern: "On firing, `amount`
// lanterns appear on a circle of radius `orbit` around the player's center,
// evenly spaced", so with the row's `amount` of `1` the single lantern's
// center is exactly `orbit` from the lamplighter's center on the tick it is
// created, whatever angle the build starts it at.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Lantern
// at level 1 alone. Lantern needs no target, so the world holds no enemy and
// the set hits nothing. `effectMotion` stays off, so the lanterns hold the
// angle they were created at, and the lamplighter does not move, so the circle
// they ride stays centered on the origin.
//
// THE TOLERANCE. `REAL_EPS` on the radius, one table figure times one
// multiplier, and `MOTION_EPS` on the orbit, a distance between two centers;
// the unscaled figures, `14` and `90`, are far outside both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { LANTERN_LEVELS, MOTION_EPS, REAL_EPS, areaMul } from "../constants";
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

const ORBIT = ROW.orbit * areaMul(GLASS);
const RADIUS = ROW.radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Lantern set's lantern radius 16.8 on an orbit of 108 under Glass 2", async () => {
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
    RADIUS,
    REAL_EPS,
    "the lantern's radius under Glass 2 (specs/passives.md, Area)",
  );
  assertNear(
    distance(lanterns[0], firing.after.run.player),
    ORBIT,
    MOTION_EPS,
    "the lantern's distance from the lamplighter's center under Glass 2 (specs/passives.md, Area)",
  );
});
