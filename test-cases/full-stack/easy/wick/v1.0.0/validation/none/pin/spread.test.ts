// Wick — pin/spread: darts spread vertically by `PIN_SPREAD`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "Amount `n`
// darts fire on the same tick, spread vertically: dart `i`, counted from `0`,
// starts at `x = player.x` and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`,
// with `PIN_SPREAD` (`10`)." Row 4 of `PIN_LEVELS` has amount `3`, so the
// three darts start at `player.x` with y offsets `-10`, `0`, and `10`.
// `specs/world.md` (phase 6) has a new projectile "hitting at the position it
// was created at and first moving on the next tick", so the firing tick's
// snapshot reads each dart where it started.
//
// WHAT IS READ. The offsets of the three darts from the lamplighter's center,
// sorted, against the three the formula gives: the specification counts the
// darts by `i` without fixing which id each takes, so the set is compared
// rather than the order.
//
// THE POSE. The lamplighter posed off the origin, so the offsets are read
// against a center that is not `(0, 0)`, then Pin held at level 4, due at
// once, fired through the shared `fireWeapon` on an isolated night. Pin needs
// no target, so no enemy is posed; nothing else runs, and `effectMotion` is
// held so each dart is read exactly where the firing put it.
//
// TOLERANCE. `POSITION_TOL` on each start position, a sum of the player's
// position and a table figure; the neighbouring offset is `10` units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PIN_SPREAD, POSITION_TOL, weaponRow } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { firePin } from "./stage";

/** The row of three darts: `PIN_LEVELS` row 4. */
const LEVEL = 4;

/** The row's amount, `3`. */
const AMOUNT = weaponRow("pin", LEVEL).amount!;

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

it("starts three darts at player.x and player.y + (-10, 0, 10)", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);
  const posed = await h.snapshot();
  assertNear(
    posed.run.player.x,
    PLAYER.x,
    POSITION_TOL,
    "the player's x posed",
  );
  assertNear(
    posed.run.player.y,
    PLAYER.y,
    POSITION_TOL,
    "the player's y posed",
  );

  const fired = await firePin(h, LEVEL);
  await captureStill(h, "spread");

  const at = fired.after.run.player;
  const darts = fired.projectiles.filter((shape) => shape.weapon === "pin");
  assertEqual(darts.length, AMOUNT, "Pin darts the firing tick created");
  for (const dart of darts) {
    assertNear(dart.x, at.x, POSITION_TOL, `dart ${dart.id}: start x`);
  }
  const offsets = darts.map((dart) => dart.y - at.y).sort((a, b) => a - b);
  for (const [index, wanted] of OFFSETS.entries()) {
    assertNear(
      offsets[index]!,
      wanted,
      POSITION_TOL,
      `the ${index}th smallest y offset of the three darts`,
    );
  }
});
