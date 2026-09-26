// Wick — evolutions/hail-spread: Hail's six darts spread by `PIN_SPREAD` and
// leave in the facing direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Hail"): "a circle of
// `radius` fired horizontally in the facing direction at `speed` ... Amount `n`
// darts fire on the same tick, dart `i` counted from `0` starting at
// `x = player.x` and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with
// `PIN_SPREAD` (`10`)." `HAIL_STATS` gives amount `6` and speed `700`, and
// `specs/passives.md` leaves `PIN_SPREAD` "unchanged by any passive". So the six
// darts start at `player.x` with `y` offsets `-25`, `-15`, `-5`, `5`, `15`, and
// `25`, each with velocity `(700, 0)` while facing is `"right"`
// (`specs/weapons.md`, "The nearest enemy": the facing direction is "`+x` for
// `"right"`"). `specs/world.md` (phase 6) has a new projectile "hitting at the
// position it was created at and first moving on the next tick", so the firing
// tick's snapshot reads each dart where it started.
//
// WHAT IS READ. The offsets of the six darts from the lamplighter's center,
// sorted, against the six the formula gives: the specification counts the darts
// by `i` without fixing which id each takes, so the set is compared rather than
// the order.
//
// THE POSE. An isolated night with the lamplighter posed off the origin, so the
// offsets are read against a center that is not `(0, 0)`, facing posed right,
// and Hail held at level 1 fired through the shared `fireWeapon`. No enemy is
// posed, and `effectMotion` is off.
//
// TOLERANCE. `POSITION_TOL` on each start position, a sum of the lamplighter's
// position and a fixed figure; the neighbouring offset is `10` units away.
// `FLOAT_TOL` on each velocity component.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, PIN_SPREAD, POSITION_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { boltsFired } from "./stage";

/** Hail's fixed amount, `6`. */
const AMOUNT = weaponRow("hail").amount as number;

/** Hail's fixed speed, `700`. */
const SPEED = weaponRow("hail").speed as number;

/** Where the lamplighter stands: off the origin, so the offsets are relative. */
const PLAYER = { x: 300, y: -200 };

/** The offsets the formula gives dart `i`: `(i − (n − 1) / 2) × PIN_SPREAD`. */
const OFFSETS = Array.from(
  { length: AMOUNT },
  (_, i) => (i - (AMOUNT - 1) / 2) * PIN_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts six darts at player.x with y offsets -25 to 25 and velocity (700, 0)", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);
  await h.debug.setFacing("right");

  const firing = await fireWeapon(h, "hail", 1);
  await captureStill(h, "spread");

  const at = firing.after.run.player;
  const darts = boltsFired(firing, "hail");
  assertEqual(darts.length, AMOUNT, "Hail darts the firing tick created");
  for (const dart of darts) {
    assertNear(dart.x, at.x, POSITION_TOL, `dart ${dart.id}: start x`);
    assertNear(dart.vx, SPEED, FLOAT_TOL, `dart ${dart.id}: velocity x`);
    assertNear(dart.vy, 0, FLOAT_TOL, `dart ${dart.id}: velocity y`);
  }
  const offsets = darts.map((dart) => dart.y - at.y).sort((a, b) => a - b);
  for (const [index, wanted] of OFFSETS.entries()) {
    assertNear(
      offsets[index] as number,
      wanted,
      POSITION_TOL,
      `the ${index}th smallest y offset of the six darts`,
    );
  }
});
