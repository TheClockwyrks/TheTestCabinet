// Wick — passives/glass-scales-lantern-orbit: `areaMul` scales a lantern set's
// orbit.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table
// names "Lantern, Chandelier | `orbit`, lantern `radius`" among the lengths
// `areaMul` scales, over "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with
// `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of `LANTERN_LEVELS`
// (`specs/weapons.md`) carries orbit `90`, so with Glass at level 2 the
// lantern rides a circle of radius `108`. ("Lantern") "On firing, `amount`
// lanterns appear on a circle of radius `orbit` around the player's center",
// so the distance from the lamplighter's center to the lantern's is the orbit.
// The other length the same table row covers is `passives/glass-scales-
// lantern-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and
// Lantern held at level 1 and fired by one tick. Lantern "needs no target", so
// no enemy is posed. Every other faculty stays held: `effectMotion` off keeps
// the lantern at the angle it was created at, and the lamplighter stands at
// the origin, so the distance read is the circle the set was created on.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on the orbit, a distance a build computed
// from a cosine and a sine. The unscaled `90` is units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  LANTERN_LEVELS,
  MOTION_TOLERANCE,
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
import { armAll, holdPassives, orbitOf } from "./night";

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

it("gives the level-1 lantern orbit 108 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["lantern", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "lantern");

  const lanterns = zonesOfKind(after, "lantern");
  assertLength(lanterns, 1, "lanterns after the firing tick");
  assertWithin(
    orbitOf(after, lanterns[0]),
    LANTERN_LEVELS[LEVEL - 1].orbit * AREA,
    MOTION_TOLERANCE,
    "the lantern's distance from the lamplighter, the orbit it rides",
  );
});
