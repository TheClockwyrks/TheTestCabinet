// Wick — passives/glass-scales-dart-radius: `areaMul` scales a dart's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Ember, Pin, Beacon, Hail | bolt `radius`" among them, over "`areaMul
// = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL` (`0.1`).
// Row 1 of `PIN_LEVELS` (`specs/weapons.md`) carries radius `6`, so with Glass
// at level 2 the dart reads `7.2`. The other radius the same table row covers
// is `passives/glass-scales-bolt-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and the
// weapon held at level 1 and fired by one tick. It fires "whether or not any
// enemy exists", so no enemy is posed. Every other faculty stays held, so
// nothing travels and nothing else fires: the reading is the projectile the
// tick created.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `6` is more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  PIN_LEVELS,
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
import { armAll, holdPassives } from "./night";

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

it("gives the level-1 dart radius 7.2 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["pin", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "dart");

  const shots = projectilesOf(after, "pin");
  assertLength(shots, 1, "shots after the firing tick");
  assertWithin(
    shots[0].radius,
    PIN_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the dart's radius with Glass 2 held",
  );
});
