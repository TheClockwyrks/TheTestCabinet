// Wick — passives/glass-scales-lantern-radius: `areaMul` scales a lantern
// set's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table
// names "Lantern, Chandelier | `orbit`, lantern `radius`" among the lengths
// `areaMul` scales, over "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with
// `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of `LANTERN_LEVELS`
// (`specs/weapons.md`) carries radius `14`, so with Glass at level 2 the
// lantern reads `16.8`. The other length the same table row covers is
// `passives/glass-scales-lantern-orbit`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and
// Lantern held at level 1 and fired by one tick. Lantern "needs no target", so
// no enemy is posed. Every other faculty stays held: `effectMotion` off keeps
// the lantern at the angle it was created at, and the lamplighter stands at
// the origin, so the distance read is the circle the set was created on.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `14` is units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  LANTERN_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Lantern level fired: row 1, orbit 90, radius 14, amount 1. */
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

it("gives the level-1 lantern radius 16.8 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["lantern", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "lantern");

  const lanterns = zonesOfKind(after, "lantern");
  assertLength(lanterns, 1, "lanterns after the firing tick");
  assertWithin(
    lanterns[0].radius,
    LANTERN_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the lantern's radius with Glass 2 held",
  );
});
