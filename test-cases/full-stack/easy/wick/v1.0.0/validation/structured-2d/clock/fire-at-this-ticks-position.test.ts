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
//     `TICK_DT`", `MOVE_SPEED` 180, so one tick with `right` held moves the
//     lamplighter 3 units right.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction, and it is
//     centered vertically on the player's `y`." And `specs/state.md`
//     (`ZoneState`): "`x`, `y`: ... for a slash the center of the rectangle";
//     "`width`, `height`: the full extent of a slash's rectangle".
//   - `specs/controls.md`: `right` is bound to `ArrowRight`, read as a held
//     value on `playing`.
//
// THE DRIVE. An isolated run keeping Taper, armed, with `weaponFire` on and
// every other switch off; the run begins facing right. `ArrowRight` is held
// for the one frame that runs the firing tick. On that tick the lamplighter
// moves to `x = 3` and Taper fires: the slash's near edge, its center `x`
// less half its `width`, must be at the moved `player.x` of 3, and not at the
// 0 the tick began at.
//
// TOLERANCE. `MOTION_EPS` on both readings: the move is one integration step
// and the edge is a center less half a width, each rounding by ulps; 3 units
// separates the two positions the requirement tells apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  hold,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

/** One tick of movement to the right, in units. */
const STEP = MOVE_SPEED * TICK_DT;

/** Taper's slot in a fresh run: the first. */
const TAPER_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the slash's near edge at the lamplighter's x after this tick's move", async () => {
  const posed = isolate(h, { taper: true });
  assertEqual(posed.run.player.facing, "right", "the fresh run's facing");
  armWeapon(h, TAPER_SLOT);

  const after = await hold(h, "ArrowRight", 1);
  captureStill(h, "moved");

  assertNear(
    after.run.player.x,
    posed.run.player.x + STEP,
    MOTION_EPS,
    "player.x after the tick with right held",
  );
  const slashes = zonesOfKind(after, "slash");
  assertEqual(slashes.length, 1, "the slashes Taper fired on that tick");
  const slash = slashes[0];
  assertNear(
    slash.x - (slash.width ?? Number.NaN) / 2,
    after.run.player.x,
    MOTION_EPS,
    "the slash's near edge, against the moved player.x",
  );
});
