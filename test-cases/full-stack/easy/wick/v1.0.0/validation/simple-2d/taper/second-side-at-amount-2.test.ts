// Wick — taper/second-side-at-amount-2: with amount 2 a second slash fires on
// the same tick, mirrored to the other side of the player.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "With amount `2` a second slash fires on
//     the same tick, mirrored to the opposite side of the player." The
//     level-3 row has width `120` and amount `2`.
//   - `specs/weapons.md` ("Taper"): the first slash's "near vertical edge is
//     at the player's `x`, it extends `width` in the facing direction", so
//     with `facing` `right` the mirrored one spans `player.x − 120` to
//     `player.x`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", and with no Mirror held the bonus is 0
//     (`specs/passives.md`).
//
// WHAT IS READ. Two moths on the firing tick, one at `(player.x + 100,
// player.y)` and one at `(player.x − 100, player.y)`, one inside each of the
// two rectangles. Both are hit on that one tick.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 3, facing right, every
// switch but `weaponFire` off, so the slashes are the only things that can
// change a moth. A hit moth dies on the tick (HP 5 against damage 15), so a
// hit reads as the moth gone.
//
// TOLERANCE. None: each probe is read as hit or not hit.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { PROBE, armTaper, assertHit } from "./slash";

/** The first level whose row has amount 2. */
const LEVEL = 3;

/** How far along each side the two probes stand, inside a width of 120. */
const PROBE_DX = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth on each side of the player on the one firing tick at level 3", async () => {
  armTaper(h, LEVEL, "right");
  const ahead = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  const behind = spawnEnemyNear(h, PROBE, -PROBE_DX, 0);
  const before = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "both");

  assertHit(before, after, ahead, "the moth 100 along +x, the facing side");
  assertHit(before, after, behind, "the moth 100 along -x, the mirrored side");
});
