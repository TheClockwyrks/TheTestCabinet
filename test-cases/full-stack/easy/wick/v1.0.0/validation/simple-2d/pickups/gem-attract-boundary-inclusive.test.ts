// pickups/gem-attract-boundary-inclusive — the attraction radius is inclusive:
// a gem at exactly pickupRadius is attracted.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "a
// gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted". "At most" puts the boundary itself inside the rule, and
// `pickupRadius` is `PICKUP_RADIUS` (48) with no Lure held. A gem placed
// exactly `PICKUP_RADIUS` units along `+x` therefore reads `attracted` true
// after one tick; a build testing the distance with a strict `<` leaves it
// false and fails.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so no Lure
// widens the radius and no draft attracts the gem behind the reading. The gem
// sits along `+x` alone, so its distance is the whole number 48 rather than a
// hypotenuse, which is exact in a double and puts the reading on the boundary
// itself rather than a rounding either side of it. The lamplighter never moves,
// so that distance is the one the deciding tick reads.
//
// WHAT IS READ. The gem's `attracted` after one real tick, true, with its
// distance read back off the snapshot as exactly `PICKUP_RADIUS` first, so a
// build whose `pickupRadius` is not 48 fails on the pose rather than silently
// answering a different question.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the posed distance and on
// `pickupRadius`, each a stated figure read back as a double; none on
// `attracted`, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { distanceToPlayer, gemOf } from "./night";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("attracts a gem at exactly 48 units on the next tick", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  assertWithin(
    posed.run.pickupRadius,
    PICKUP_RADIUS,
    FIGURE_TOLERANCE,
    "pickupRadius with no Lure held",
  );
  const { player } = posed.run;
  const gem = spawnGemAt(h, "small", player.x + PICKUP_RADIUS, player.y);
  const placed = h.snapshot();
  assertWithin(
    distanceToPlayer(placed, gemOf(placed, gem)),
    PICKUP_RADIUS,
    FIGURE_TOLERANCE,
    "the posed gem's distance from the lamplighter, in units",
  );
  assertEqual(
    gemOf(placed, gem).attracted,
    false,
    "the posed gem's attracted flag before any tick",
  );

  const after = await h.tick(1);
  captureStill(h, "boundary");

  assertEqual(
    gemOf(after, gem).attracted,
    true,
    `the attracted flag of a gem exactly ${PICKUP_RADIUS} units out`,
  );
});
