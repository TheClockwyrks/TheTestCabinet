// Wick — clock/fire-at-this-ticks-position: a weapon fires from the
// lamplighter's position of this tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 2, "The lamplighter moves and
//     `facing` updates", comes before phase 5, "each weapon whose timer is due
//     fires, creating its projectiles and zones at the lamplighter's and the
//     enemies' positions of this tick."
//   - `specs/world.md` ("Movement"): "The velocity is that direction times
//     `moveSpeed`, and each tick the position advances by the velocity times
//     `TICK_DT`", with `MOVE_SPEED` `180`, so one tick of `right` moves the
//     lamplighter 3 units.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the player's
//     `x`, it extends `width` in the facing direction, and it is centered
//     vertically on the player's `y`"; `specs/state.md` (`ZoneState`): a
//     slash's `x`, `y` is "the center of the rectangle" and `width`, `height`
//     "the full extent of a slash's rectangle".
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. Taper is armed to fire on the next tick, and `right` is held
// for that one tick. The tick moves the lamplighter to `x = 3` and then fires
// the slash, so the slash's near edge, its center `x` less half its `width`
// with `facing` `right`, must be at 3, the moved position, and not at 0, where
// the tick began.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper needs no target, so the night holds
// nothing but the lamplighter and the armed Taper; the movement is a real held
// key because the position of "this tick" is the one the tick's own movement
// phase produces. The lamplighter's move is asserted first, so the near edge
// is read against a position that did change.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the moved `x` and on the near edge,
// positions integrated by one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, MOVE_SPEED, TICK_DT } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  hold,
  isolate,
  keysOf,
  zonesOfKind,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds to `right`. */
const RIGHT_KEY = keysOf("right")[0];

/** Where one tick of `right` puts the lamplighter: 180 × 1 / 60 = 3. */
const MOVED_X = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the slash's near edge at the lamplighter's moved x", async () => {
  const posed = isolate(h, { keepTaper: true });
  assertEqual(posed.run.weapons[0]?.id, "taper", "the weapon held");
  assertEqual(posed.run.player.facing, "right", "facing before the tick");
  armWeapon(h, 0);

  const after = await hold(h, RIGHT_KEY, 1);
  captureStill(h, "moved");

  assertWithin(
    after.run.player.x,
    posed.run.player.x + MOVED_X,
    MOTION_TOLERANCE,
    "the lamplighter's x after one tick of right",
  );
  const slashes = zonesOfKind(after, "slash");
  assertEqual(slashes.length, 1, "slashes on the firing tick");
  const slash = slashes[0];
  assertWithin(
    slash.x - (slash.width ?? Number.NaN) / 2,
    after.run.player.x,
    MOTION_TOLERANCE,
    "the slash's near edge against the moved player.x",
  );
});
