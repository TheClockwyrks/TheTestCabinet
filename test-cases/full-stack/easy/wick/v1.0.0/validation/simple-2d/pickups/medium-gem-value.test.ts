// pickups/medium-gem-value — a medium gem is worth 3 experience.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Gems") tables the tiers and
// what each grants, "`GEM_VALUES` gives the experience each grants", with the
// row "| `medium` | `3` |"; and ("Attraction and flight") the gain itself:
// "a gem whose center is at most `COLLECT_RADIUS` from the lamplighter's
// center is collected on that tick: it is removed, and `xp` rises by
// `GEM_VALUES[tier] × xpMul`, a real number. `xpMul` is `1` with no Soot
// held." So one medium gem collected with nothing held raises `xp` by exactly
// `GEM_VALUES.medium` (3).
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else dropped,
// no weapon and no passive held, every driver switch off. Soot is the only
// thing that scales a gain and no passive is held, so `xpMul` is `1` and the
// gain read is the tier's own figure. `progression` is one of the switches
// `isolate` holds off, so the gain reaches `xp` and is spent on no level: no
// overlay opens over the reading, whatever the build's own `xpToNext`.
//
// WHAT IS READ. `xp` after one real tick, with the gem gone from the field, so
// the figure is a collection rather than a number posed beside one. The gem
// lies at the lamplighter's center, inside both `pickupRadius` (48) and
// `COLLECT_RADIUS` (8), so that one tick attracts it, moves it nowhere, and
// collects it, the order specs/world.md ("One tick", phase 9) fixes.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `xp`, "a real number" read back as
// a double; none on the gem count, which the specification decides exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, GEM_VALUES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The tier collected, and the experience specs/world.md gives it. */
const TIER = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises xp by exactly 3 when a medium gem is collected", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so xpMul is 1");
  const { player } = posed.run;
  spawnGemAt(h, TIER, player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "medium");

  assertLength(after.run.gems, 0, "gems left after the collecting tick");
  assertWithin(
    after.run.xp - posed.run.xp,
    GEM_VALUES[TIER],
    FIGURE_TOLERANCE,
    "the experience the medium gem granted",
  );
});
