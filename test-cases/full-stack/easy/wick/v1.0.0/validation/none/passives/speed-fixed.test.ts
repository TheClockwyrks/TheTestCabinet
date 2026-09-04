// Wick — passives/speed-fixed: a projectile's speed is the table figure at
// every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("What passives leave as
// written"): "Projectile `speed` and `duration` are used as written for every
// weapon, at every passive level, so a bolt travels the same distance ...
// whatever the passives held." `specs/weapons.md` ("Derived stats") says the
// same in its table: "Speed, Pierce, Duration | table value, unchanged". Row 1
// of `EMBER_LEVELS` carries speed `400`, so the bolt leaves at `400` units per
// second and covers `400 / 60` units on each tick it moves, whatever is held.
//
// THE POSE. An isolated night with Glass 5, Oil 5, Wick 5, and Mirror 2 held
// through `setPassive`, every one of the four multipliers a weapon reads at its
// largest, and one hound posed `FAR` (`5000`) units along `+x`: Ember "needs at
// least one enemy to fire", and at that distance no bolt reaches it inside its
// `2.0` seconds of `ttl`. With Mirror 2 the amount is `3`, and "fewer when
// fewer enemies exist", so the one enemy draws exactly one bolt. `effectMotion`
// is then turned on and `weaponFire` off, so the bolt flies and nothing else
// fires, and `MOVE` (`10`) ticks are driven: the reading is the velocity the
// firing gave it and the distance it actually covered.
//
// TOLERANCE. `FLOAT_TOL` on the speed, the magnitude of a velocity a build
// computed as the speed times a unit vector, and `POSITION_TOL` (`1e-6`) on the
// distance covered over ten ticks. A build scaling the speed by any of the four
// multipliers held is tens of units per second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, TICK_DT, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  distanceBetween,
  enable,
  fireWeapon,
  holdPassive,
  isolate,
  mustProjectile,
  type Harness,
} from "../harness";
import { placeFarTarget } from "./stage";

/** The Ember level fired: table speed `400`. */
const LEVEL = 1;

/** Every multiplier a weapon reads, at the largest level its passive allows. */
const HELD = [
  { id: "glass", level: 5 },
  { id: "oil", level: 5 },
  { id: "wick", level: 5 },
  { id: "mirror", level: 2 },
] as const;

/** The ticks of flight the distance is read over. */
const MOVE = 10;

/** `400`, the table figure. */
const SPEED = weaponRow("ember", LEVEL).speed ?? NaN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a level-1 Ember bolt at 400 units per second with Glass 5, Oil 5, Wick 5, and Mirror 2 held", async () => {
  await isolate(h);
  for (const passive of HELD) await holdPassive(h, passive.id, passive.level);
  await placeFarTarget(h, "hound");

  const firing = await fireWeapon(h, "ember", LEVEL);
  const bolts = firing.projectiles.filter((shot) => shot.weapon === "ember");
  assertEqual(bolts.length, 1, "Ember bolts the firing tick created");
  assertNear(
    Math.hypot(bolts[0]!.vx, bolts[0]!.vy),
    SPEED,
    FLOAT_TOL,
    "the bolt's speed with every multiplier held",
  );

  await disable(h, "weaponFire");
  await enable(h, "effectMotion");
  const flown = await h.step(MOVE);
  await captureStill(h, "speed");

  assertNear(
    distanceBetween(bolts[0]!, mustProjectile(flown, bolts[0]!.id)),
    SPEED * TICK_DT * MOVE,
    POSITION_TOL,
    `the units the bolt covered over ${MOVE} ticks`,
  );
});
