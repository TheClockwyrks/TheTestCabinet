// pickups/gem-collected-within-radius — collection is decided after the flight
// step, at COLLECT_RADIUS.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight")
// tables "Collection distance | `COLLECT_RADIUS` | `8`" and applies it: "An
// attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT` ... After it moves, a gem whose center is at most
// `COLLECT_RADIUS` from the lamplighter's center is collected on that tick: it
// is removed, and `xp` rises by `GEM_VALUES[tier] × xpMul`". A step is
// `GEM_STEP` (10) units, so a gem posed `INSIDE` (17) units out ends the tick 7
// units from the center, inside the 8, and one posed `OUTSIDE` (19) units out
// ends it 9 units from the center, outside the 8. The rule is read from both
// sides on the same tick, which is what pins the figure rather than the
// direction of the comparison.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// moves in the night but the two gems and nothing else can remove either. Both
// are latched attracted with `setGemAttracted`, so each takes its step on the
// tick that follows; they lie on opposite sides of the lamplighter, along `+x`
// and `−x`, so neither can be mistaken for the other and each step is one axis
// wide. They carry different tiers, `medium` (3) and `large` (10), so the
// experience gained names which of the two was collected. `isolate` poses
// `ISOLATE_LEVEL` (50), whose `xpToNext` is 495, so the gain opens no overlay.
//
// WHAT IS READ. After one tick: the inside gem gone, the outside gem still on
// the field 9 units from the lamplighter, and `xp` risen by the inside gem's
// value alone.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the surviving gem's distance, a
// position carried through one integrated step; `FIGURE_TOLERANCE` (1e-9) on
// `xp`, a stated figure read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertUndefined, assertWithin } from "../assert";
import {
  COLLECT_RADIUS,
  FIGURE_TOLERANCE,
  GEM_VALUES,
  MOTION_TOLERANCE,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { GEM_STEP, distanceToPlayer, gemById, gemOf } from "./night";

/** Posed along +x: 17 − 10 = 7 units out after the step, inside COLLECT_RADIUS. */
const INSIDE = 17;

/** Posed along −x: 19 − 10 = 9 units out after the step, outside it. */
const OUTSIDE = 19;

/** The tier that is collected, and the tier that is not. */
const INSIDE_TIER = "medium";
const OUTSIDE_TIER = "large";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("collects the gem that ends its step 7 units out and leaves the one that ends 9 out", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const near = spawnGemAt(h, INSIDE_TIER, player.x + INSIDE, player.y);
  const far = spawnGemAt(h, OUTSIDE_TIER, player.x - OUTSIDE, player.y);
  h.debug.setGemAttracted(near, true);
  h.debug.setGemAttracted(far, true);

  const after = await h.tick(1);
  captureStill(h, "collected");

  assertUndefined(
    gemById(after, near),
    `the gem that ended the step ${INSIDE - GEM_STEP} units out, inside ${COLLECT_RADIUS}`,
  );
  assertLength(after.run.gems, 1, "gems left after the tick");
  assertWithin(
    distanceToPlayer(after, gemOf(after, far)),
    OUTSIDE - GEM_STEP,
    MOTION_TOLERANCE,
    `the distance of the gem that ended the step outside ${COLLECT_RADIUS}, in units`,
  );
  assertWithin(
    after.run.xp - posed.run.xp,
    GEM_VALUES[INSIDE_TIER],
    FIGURE_TOLERANCE,
    "the experience gained, the collected gem's value alone",
  );
});
