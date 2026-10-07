// Wick — taper/slash-faces-left: with `facing` `left` the slash extends
// toward −x.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction"; the level-1
//     row has width `120`.
//   - `specs/weapons.md` ("The nearest enemy"): "The facing direction is
//     `facing` from `specs/world.md`: `+x` for `"right"` and `-x` for
//     `"left"`", so with `facing` `left` the rectangle spans `x` from
//     `player.x − 120` to `player.x`.
//   - `specs/instrumentation.md` (`setFacing`): "Sets `facing` to `facing`,
//     `"left"` or `"right"`."
//
// WHAT IS READ. Two moths on the firing tick, one at `(player.x − 100,
// player.y)`, inside the left-facing rectangle, and one at
// `(player.x + 100, player.y)`, on the side the slash does not reach: its
// nearest point is `(player.x, player.y)`, 100 away against a radius of 10.
// The left moth is hit and the right moth is not.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 1, `facing` posed to
// `left` through its own operation, every switch but `weaponFire` off, so
// the slash is the only thing that can change a moth. A hit moth dies on the
// tick (HP 5 against damage 10), so a hit reads as the moth gone and a miss
// as the moth standing with its hp untouched.
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

/** How far along each side the two probes stand. */
const PROBE_DX = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the moth 100 along -x and not the one 100 along +x when facing left", async () => {
  armTaper(h, 1, "left");
  const left = spawnEnemyNear(h, PROBE, -PROBE_DX, 0);
  const right = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  const before = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "left");

  assertHit(before, after, left, "the moth 100 along -x");
  assertUnhurt(before, after, right, "the moth 100 along +x");
});
