// clock/fire-at-this-ticks-position — a weapon fires from the lamplighter's
// position of this tick, after the movement phase.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"): phase 2, "The
// lamplighter moves and `facing` updates", comes before phase 5, "each weapon
// whose timer is due fires, creating its projectiles and zones at the
// lamplighter's and the enemies' positions of this tick". The movement is
// ("Movement"): a held `right` is `(1, 0)`, "the velocity is that direction
// times `moveSpeed`, and each tick the position advances by the velocity
// times `TICK_DT`", `180 / 60`, three units. The slash is (specs/weapons.md,
// "Taper"): "Its near vertical edge is at the player's `x`, it extends `width`
// in the facing direction, and it is centered vertically on the player's `y`",
// and (specs/weapons.md, "Shapes and overlap") "Every zone's position is the
// center of its shape ... a slash carries its `width` and `height`". So facing
// right, the slash's near edge is its center `x` less half its `width`.
//
// THE DRIVE. Taper held with its timer at `0`, `weaponFire` on, and
// `ArrowRight` held for exactly one frame. That tick moves the lamplighter
// three units right and then fires: the slash's near edge is at the moved
// `player.x`, three, rather than at the zero the tick began at. `facing`
// stays `"right"`, the direction a fresh run faces and the one the held key
// keeps.
//
// THE NIGHT. An isolated run with Taper alone and nothing else in it. Taper
// "needs no target", so no enemy is posed, and every other faculty is held.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position integrated on the tick
// is allowed, on figures a build reaches in one multiplication and one
// subtraction. The figure that separates this tick's position from the one
// the tick began at is the step, `3` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, MOVE_STEP, POSITION_TOL } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdKeys,
  holdWeapon,
  isolate,
  newZones,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires the slash from the position the tick moved the lamplighter to", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, "taper");
  await armWeapon(h, slot);
  await enable(h, "weaponFire");
  const before = await h.snapshot();
  const after = await holdKeys(h, [BINDINGS.right[0]!], 1);
  await captureStill(h, "moved");

  const at = after.run.player;
  assertNear(
    at.x,
    before.run.player.x + MOVE_STEP,
    POSITION_TOL,
    "player.x after one tick with right held",
  );
  assertEqual(at.facing, "right", "facing after one tick with right held");

  const slashes = newZones(before, after).filter(
    (zone) => zone.kind === "slash",
  );
  assertEqual(slashes.length, 1, "slashes Taper created on the tick");
  const slash = slashes[0]!;
  assertNear(
    slash.x - (slash.width ?? NaN) / 2,
    at.x,
    POSITION_TOL,
    "the slash's near edge, against the lamplighter's x after its move on the same tick",
  );
});
