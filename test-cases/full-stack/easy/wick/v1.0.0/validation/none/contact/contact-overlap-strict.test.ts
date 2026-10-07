// contact/contact-overlap-strict — contact needs the centers closer than the
// radii's sum, strictly.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "the enemy's
// circle overlaps the lamplighter's when the distance between their centers is
// less than the enemy's radius plus `PLAYER_RADIUS`". A rat's radius is 12
// (specs/enemies.md — "Rat | `rat` | 15 | 120 | 8 | 12") and `PLAYER_RADIUS` is
// 12 (specs/world.md — "The lamplighter"), so the sum is 24: a rat whose center
// is exactly 24 from the lamplighter's does not overlap, and one at 23.9 does.
// The rat's damage is 8, so the one that hits takes `hp` from 100 to 92.
//
// 24 IS THE BOUNDARY, and it is posed deliberately: a build that wrote `<=` for
// the rule hits at exactly 24 and fails here, while a build that wrote the
// stated `<` passes. The rat at 23.9 is the control that stops a build whose
// contact never lands from passing this point by refusing everything: what it
// reads is that `hp` fell at all, because how much a rat's hit takes is the
// contact damage point, not this one.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off, so
// each rat is tested at exactly the point it was posed. The lamplighter stands
// at the origin, so the rat at `(24, 0)` is at a distance of exactly 24 with no
// rounding: both figures are integers. Sixty ticks are run, well past the 30 a
// due cooldown would wait, and `hp` must not have moved. Then that rat is
// removed, one is posed at `(23.9, 0)`, and one tick is run, on which it hits.
//
// THE TOLERANCE. `FLOAT_TOL` on the reading at the boundary: no hit leaves `hp`
// exactly at `BASE_MAX_HP`. Recovery is 0 with no Tinder held and nothing
// heals, so nothing else moves the figure, and the control needs no tolerance:
// `hp` either fell or it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNear } from "../assert";
import { BASE_MAX_HP, ENEMIES, FLOAT_TOL, PLAYER_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** Exactly the radii's sum: 12 + 12. */
const AT_BOUNDARY = ENEMIES.rat.radius + PLAYER_RADIUS;

/** A tenth inside it. */
const INSIDE_BOUNDARY = AT_BOUNDARY - 0.1;

/** Ticks the rat at the boundary stands there: twice the 30 a cooldown waits. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands no hit at exactly 24 units and hits at 23.9", async () => {
  await isolate(h, { on: ["enemyContact"] });
  const atBoundary = await placeEnemyNear(h, "rat", AT_BOUNDARY, 0);

  const held = await h.step(HELD_TICKS);
  assertNear(
    player(held).hp,
    BASE_MAX_HP,
    FLOAT_TOL,
    `hp after ${HELD_TICKS} ticks with a rat exactly 24 units from the center`,
  );

  await h.debug.removeEnemy(atBoundary.id);
  await placeEnemyNear(h, "rat", INSIDE_BOUNDARY, 0);
  const inside = await h.step(1);

  // The rat a tenth inside the boundary, with its hit on the HUD. Captured
  // before the assertion, so a failing build leaves the picture that shows why.
  await captureStill(h, "boundary");

  assertLessThan(
    player(inside).hp,
    BASE_MAX_HP,
    "hp after one tick with a rat 23.9 units from the center",
  );
});
