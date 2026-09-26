// Wick — taper/rect-overlap-nearest-point: the slash overlaps a circle by the
// distance from the circle's center to the rectangle's nearest point.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shapes and overlap"):
// "A rectangle and a circle overlap when the distance from the circle's center
// to the nearest point of the rectangle is less than the circle's radius."
// ("Taper"): the near edge is at the player's `x` and the slash "extends
// `width` in the facing direction", `120` at level 1, so with the lamplighter
// at the origin facing right the far edge is the segment at `x = 120`. A moth
// is a circle of radius `10` (`specs/enemies.md`).
//
// THE PROBES. Two moths on the player's `y`, beyond the far edge:
//   - center at `x = 125`, `5` units past the edge: its nearest point is
//     `(120, 0)`, distance `5`, below `10`, so it is hit;
//   - center at `x = 130`, `10` units past the edge: distance `10`, which is
//     not below `10`, so it is not.
// The second is the bound itself, which the specification makes strict, so a
// build that tests "at most" hits it and fails; the first is halfway inside
// the radius, so a build that tests the circle's CENTER against the rectangle
// misses it and fails. Every figure is an integer, so the distances are exact.
//
// THE POSE. An isolated night, facing posed right, the two moths placed, and
// Taper at level 1 fired by one tick (`taper/stage.ts`).
//
// TOLERANCE. None: each moth is either gone or standing at its posed hp.

import { afterEach, beforeEach, it } from "vitest";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { assertHit, assertUntouched, MOTH_RADIUS } from "./stage";

/** The level whose row fixes the far edge: width `120`. */
const LEVEL = 1;

/** Where the far edge stands, from the player's `x`. */
const FAR_EDGE = weaponRow("taper", LEVEL).width ?? NaN;

/** How far past the edge the hit probe's center sits: half the radius. */
const INSIDE_GAP = MOTH_RADIUS / 2;

/** How far past the edge the missed probe's center sits: exactly the radius. */
const BOUNDARY_GAP = MOTH_RADIUS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a moth 5 past the far edge and not one 10 past it", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  const at = opened.run.player;
  const near = await placeEnemy(h, "moth", at.x + FAR_EDGE + INSIDE_GAP, at.y);
  const boundary = await placeEnemy(
    h,
    "moth",
    at.x + FAR_EDGE + BOUNDARY_GAP,
    at.y,
  );

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "nearest");

  assertHit(firing.after, near, "the moth 5 units past the far edge");
  assertUntouched(
    firing.after,
    boundary,
    "the moth exactly its radius past the far edge",
  );
});
