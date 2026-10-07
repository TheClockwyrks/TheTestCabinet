// passives/lure-pickup-radius — Lure multiplies the radius a gem is attracted
// within by 1 + LURE_PICKUP_PER_LEVEL per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure", with LURE_PICKUP_PER_LEVEL
// 0.25, so Lure 2 gives 1.5; and ("Pickup radius") "The radius within which a
// gem becomes attracted is PICKUP_RADIUS (48) times `pickupMul`, measured from
// the lamplighter's center to the gem's", so pickupRadius is 48 × 1.5 = 72.
// specs/world.md ("Attraction and flight"): "On every tick, a gem whose center
// is at most `pickupRadius` from the lamplighter's center becomes attracted",
// so a gem 70 units out is inside 72 and outside the base 48.
// specs/instrumentation.md ("Snapshot shape") lists `pickupRadius` among the
// derived fields.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Lure alone at level 2 in the first passive slot, every driver switch off, and
// one small gem 70 units along +x, beyond COLLECT_RADIUS (8) so the tick
// attracts it without collecting it and the flag can be read.
//
// WHAT IS READ. `pickupRadius` off the snapshot, 72, and the gem's `attracted`
// after one tick. Both are read: a build that reports the widened radius while
// attracting within the base one, and one that attracts widely without
// reporting it, each miss a reading.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the radius, a product of two stated
// figures. None on the flag, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  pickupRadiusFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { gemOf, holdPassives } from "./night";

/** The passives held: Lure at level 2. */
const HELD: HeldPassives = { lure: 2 };

/** 48 × (1 + 0.25 × 2) = 72. */
const RADIUS = pickupRadiusFor(HELD);

/** Where the gem lies: 70 units out, inside 72 and outside the base 48. */
const DISTANCE = 70;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads pickupRadius 72 with Lure 2 held and attracts a gem 70 units out", async () => {
  isolate(h);
  holdPassives(h, HELD);
  assertWithin(
    h.snapshot().run.pickupRadius,
    RADIUS,
    FIGURE_TOLERANCE,
    "pickupRadius with Lure 2 held",
  );
  const { player } = h.snapshot().run;
  const gem = spawnGemAt(h, "small", player.x + DISTANCE, player.y);

  const after = await h.tick(1);
  captureStill(h, "radius");

  assertEqual(
    gemOf(after, gem).attracted,
    true,
    `whether the gem ${DISTANCE} units out was attracted`,
  );
});
