// Wick — passives/glass-scales-sconce-radius: `areaMul` scales a sconce's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Shard, Sconce | bolt `radius`" among them, over "`areaMul = 1 +
// GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of
// `SCONCE_LEVELS` (`specs/weapons.md`) carries radius `12`, so with Glass at
// level 2 the sconce reads `14.4`. The other radius the same table row covers
// is `passives/glass-scales-shard-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and the
// weapon held at level 1 and fired by one tick. It "needs at least one enemy
// to fire", so one hound stands `FAR` (`5000`) units along `+x`, past every
// reach the shape has. Every other faculty stays held, so nothing travels and
// nothing else fires: the reading is the projectile the tick created.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `12` is more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SCONCE_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives, probesAround } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The level the weapon is held at: row 1 of its table. */
const LEVEL = 1;

/** 1 + 0.1 × 2 = 1.2. */
const AREA = derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 sconce radius 14.4 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, "moth", [{ x: 300, y: 0 }]);
  armAll(h, [["sconce", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "sconce");

  const shots = projectilesOf(after, "sconce");
  assertLength(shots, 1, "shots after the firing tick");
  assertWithin(
    shots[0].radius,
    SCONCE_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the sconce's radius with Glass 2 held",
  );
});
