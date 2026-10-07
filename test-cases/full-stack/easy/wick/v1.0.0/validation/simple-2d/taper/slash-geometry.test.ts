// Wick — taper/slash-geometry: the slash extends `width` from the player's x
// in the facing direction and is centered on the player's y.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "A slash is a rectangle of
//     `width × height`: on the tick it fires it hits every enemy overlapping
//     it ... Its near vertical edge is at the player's `x`, it extends `width`
//     in the facing direction, and it is centered vertically on the player's
//     `y`." The level-1 row has width `120` and height `40`, so with `facing`
//     `right` the rectangle spans `x` from `player.x` to `player.x + 120` and
//     `y` from `player.y − 20` to `player.y + 20`.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius"; a moth's radius is
//     `10` (`specs/enemies.md`).
//   - `specs/weapons.md` ("Cooldown timers"): Taper needs no target, and
//     `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick".
//
// WHAT IS READ. Three moths on the firing tick. One at `(player.x + 100,
// player.y)` stands inside the rectangle and is hit. One at
// `(player.x − 30, player.y)` stands behind the near edge: its nearest point
// is `(player.x, player.y)`, 30 away, past its radius of 10, so it is not
// hit. One at `(player.x + 60, player.y + 40)` stands below the bottom edge:
// its nearest point is `(player.x + 60, player.y + 20)`, 20 away, past its
// radius, so it is not hit. Each probe is at least 10 units clear of the
// boundary it tests, so no rounding of a distance can move it across.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone, at level 1, facing right, with
// every switch but `weaponFire` off: the moths hold their places, nothing
// touches the lamplighter, and the slash is the only thing that can change a
// moth. A hit moth dies on the tick (HP 5 against damage 10), so a hit reads
// as the moth gone and a miss as the moth standing with its hp untouched.
//
// TOLERANCE. None: each probe is read as hit or not hit.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { PROBE, armTaper, assertHit, assertUnhurt } from "./slash";

/** Inside the rectangle, on the player's y. */
const INSIDE_DX = 100;
/** Behind the near edge, 30 past it against a radius of 10. */
const BEHIND_DX = -30;
/** Below the bottom edge: 40 below the player's y, 20 past the edge. */
const BELOW_DX = 60;
const BELOW_DY = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the moth inside the 120 x 40 rectangle and neither of the two outside it", async () => {
  armTaper(h, 1, "right");
  const inside = spawnEnemyNear(h, PROBE, INSIDE_DX, 0);
  const behind = spawnEnemyNear(h, PROBE, BEHIND_DX, 0);
  const below = spawnEnemyNear(h, PROBE, BELOW_DX, BELOW_DY);
  const before = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "geometry");

  assertHit(before, after, inside, "the moth 100 along +x");
  assertUnhurt(before, after, behind, "the moth 30 along -x");
  assertUnhurt(before, after, below, "the moth 60 along +x and 40 along +y");
});
