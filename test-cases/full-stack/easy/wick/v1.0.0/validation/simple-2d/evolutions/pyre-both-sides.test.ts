// Wick — evolutions/pyre-both-sides: Pyre slashes both sides of the
// lamplighter on every firing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Pyre"): "Pyre is Taper's slash on both sides of
//     the player on every firing: two rectangles of `width × height`, one
//     extending `width` in the facing direction from the player's `x` and one
//     mirrored to the opposite side, each centered vertically on the player's
//     `y`, each hitting on the tick it fires alone." The fixed row has width
//     `200`, height `60`, and damage `60`.
//   - `specs/weapons.md` ("The nearest enemy"): the facing direction is "`+x`
//     for `"right"`", so with `facing` `right` one rectangle spans `player.x`
//     to `player.x + 200` and the mirrored one `player.x − 200` to `player.x`.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius", and a moth is a
//     circle of radius `10` at HP `5` (`specs/enemies.md`), so a moth standing
//     150 units along either axis direction, on the lamplighter's `y`, is
//     inside its rectangle.
//   - `specs/weapons.md` ("Hits and death"): a hit of `60` takes a moth's `5`
//     below `0`, so "the enemy dies on that tick".
//
// WHAT IS READ. Two moths on the one firing tick, one at `(player.x + 150,
// player.y)` and one at `(player.x − 150, player.y)`: both are hit on that
// tick. A build that slashes only the facing side leaves the mirrored moth
// standing.
//
// WHY THE NIGHT IS POSED AS IT IS. Pyre alone facing right, no passive held so
// the amount is the fixed `2` and the width the fixed `200`, and every driver
// switch but `weaponFire` off, so nothing moves either moth, nothing else can
// touch them, and the two slashes are the only things that can.
//
// TOLERANCE. None: each probe is read as hit or not hit.

import { afterEach, beforeEach, it } from "vitest";
import { PYRE_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved, assertHit } from "./evolved";

/** The enemy each probe is: HP 5, radius 10. */
const PROBE = "moth";

/** How far along each side the probes stand, inside a width of 200. */
const PROBE_DX = PYRE_STATS.width * 0.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth on each side of the lamplighter on the one firing tick", async () => {
  armEvolved(h, "pyre", { facing: "right" });
  const ahead = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  const behind = spawnEnemyNear(h, PROBE, -PROBE_DX, 0);
  const before = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "both");

  assertHit(before, after, ahead, "the moth 150 along +x, the facing side");
  assertHit(before, after, behind, "the moth 150 along -x, the mirrored side");
});
