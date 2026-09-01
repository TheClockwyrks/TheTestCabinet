// Wick — taper/rect-overlap-nearest-point: a rectangle and a circle overlap
// by the distance to the rectangle's nearest point, strictly.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius."
//   - `specs/weapons.md` ("Taper"): the slash's "near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction"; the level-1
//     row has width `120`, so with `facing` `right` the far edge is at
//     `player.x + 120`. A moth's radius is `10` (`specs/enemies.md`).
//
// WHAT IS READ. Two moths on the player's y, beyond the far edge. One whose
// center is 5 past the edge, at `player.x + 125`: its nearest point is the
// edge, 5 away, less than 10, so it is hit. One whose center is 10 past the
// edge, at `player.x + 130`: 10 away, not less than 10, so it is not hit. The
// two distances are exact in arithmetic on whole units, so the second probe
// sits exactly on the boundary the strict rule excludes.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 1, facing right, every
// switch but `weaponFire` off, so the slash is the only thing that can change
// a moth. A hit moth dies on the tick (HP 5 against damage 10), so a hit reads
// as the moth gone and a miss as the moth standing with its hp untouched.
//
// TOLERANCE. None: each probe is read as hit or not hit.

import { afterEach, beforeEach, it } from "vitest";
import { ENEMIES, TAPER_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { PROBE, armTaper, assertHit, assertUnhurt } from "./slash";

/** Where the far edge stands from the player's x: the level-1 width. */
const FAR_EDGE_DX = TAPER_LEVELS[0].width;

/** The probe's radius, 10. */
const RADIUS = ENEMIES[PROBE].radius;

/** Half a radius past the edge: overlapping. */
const NEAR_DX = FAR_EDGE_DX + RADIUS / 2;

/** Exactly a radius past the edge: not overlapping, by the strict rule. */
const BOUNDARY_DX = FAR_EDGE_DX + RADIUS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the moth 5 beyond the far edge and not the one exactly a radius beyond it", async () => {
  armTaper(h, 1, "right");
  const near = spawnEnemyNear(h, PROBE, NEAR_DX, 0);
  const boundary = spawnEnemyNear(h, PROBE, BOUNDARY_DX, 0);
  const before = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "nearest");

  assertHit(before, after, near, "the moth 5 beyond the far edge");
  assertUnhurt(before, after, boundary, "the moth 10 beyond the far edge");
});
