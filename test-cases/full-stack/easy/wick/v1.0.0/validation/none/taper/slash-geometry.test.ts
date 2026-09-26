// Wick — taper/slash-geometry: the slash extends `width` from the player's
// `x` in the facing direction, centered on the player's `y`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): "A slash is a
// rectangle of `width × height`: on the tick it fires it hits every enemy
// overlapping it ... Its near vertical edge is at the player's `x`, it extends
// `width` in the facing direction, and it is centered vertically on the
// player's `y`." Row 1 of `TAPER_LEVELS` gives `120 × 40`, so with the
// lamplighter at the origin facing right the rectangle spans `x` from `0` to
// `120` and `y` from `-20` to `20`. ("Shapes and overlap"): "A rectangle and a
// circle overlap when the distance from the circle's center to the nearest
// point of the rectangle is less than the circle's radius", and a moth is a
// circle of radius `10` (`specs/enemies.md`).
//
// THE PROBES. Three moths, each read against that rectangle:
//   - `(100, 0)`: inside it, distance `0`, so it is hit;
//   - `(-30, 0)`: behind the near edge, nearest point `(0, 0)`, distance `30`,
//     which is not below `10`, so it is not;
//   - `(60, 40)`: below the rectangle, nearest point `(60, 20)`, distance `20`,
//     not below `10`, so it is not.
// The second and third stand `20` and `10` units clear of the bound, so no
// rounding of the geometry reaches them; a build whose slash starts at the
// player's center, or is centered on the player, or is taller than `40`,
// touches one of them.
//
// THE POSE. An isolated night, facing posed right, the three moths placed, and
// Taper held at level 1 with its timer at `0`; one tick with `weaponFire` on
// fires it (`taper/stage.ts`). The moth at `(100, 0)` dies of the `10` damage
// against its `5` hp, which is how a hit reads.
//
// TOLERANCE. None: each moth is either gone or standing at its posed hp.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { assertHit, assertUntouched } from "./stage";

/** The level whose row the geometry is read at: `120 × 40`. */
const LEVEL = 1;

/** The probe inside the rectangle. */
const INSIDE = { x: 100, y: 0 };

/** The probe behind the near edge, on the player's `y`. */
const BEHIND = { x: -30, y: 0 };

/** The probe below the rectangle's lower edge, along the slash. */
const BELOW = { x: 60, y: 40 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a moth inside the rectangle and neither of the two outside it", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  const at = opened.run.player;
  const inside = await placeEnemy(h, "moth", at.x + INSIDE.x, at.y + INSIDE.y);
  const behind = await placeEnemy(h, "moth", at.x + BEHIND.x, at.y + BEHIND.y);
  const below = await placeEnemy(h, "moth", at.x + BELOW.x, at.y + BELOW.y);

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "geometry");

  assertHit(firing.after, inside, "the moth inside the slash");
  assertUntouched(firing.after, behind, "the moth behind the near edge");
  assertUntouched(firing.after, below, "the moth below the slash");
});
