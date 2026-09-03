// passives/soot-xp-mul — Soot multiplies the experience a gem grants by
// 1 + SOOT_XP_PER_LEVEL per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "xpMul = 1 + SOOT_XP_PER_LEVEL × soot", with SOOT_XP_PER_LEVEL 0.1, so Soot 2
// gives 1.2; and ("Experience") "The experience a collected gem grants is
// GEM_VALUES[tier] times `xpMul`, a real number added to `xp` on the tick the
// gem is collected". specs/world.md ("Gems") gives GEM_VALUES `medium` 3, so
// the gem adds 3 × 1.2 = 3.6.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Soot alone at level 2 in the first passive slot, every driver switch off, and
// `xp` at the 0 a reset leaves. One medium gem lies at the lamplighter's
// center, inside both pickupRadius and COLLECT_RADIUS (8), so the single tick
// that follows attracts and collects it, which specs/world.md ("Attraction and
// flight") has happen in that order within phase 9. `isolate` poses level 50,
// whose xpToNext is 495, so the gain crosses no threshold and no overlay opens
// over the reading.
//
// WHAT IS READ. `xp` after the collecting tick, 3.6, with the gem gone from the
// field so the gain is a collection rather than a figure posed beside one.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  GEM_VALUES,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Soot at level 2. */
const HELD: HeldPassives = { soot: 2 };

/** The gem collected: GEM_VALUES.medium is 3. */
const TIER = "medium";

/** 3 × (1 + 0.1 × 2) = 3.6. */
const GAIN = GEM_VALUES[TIER] * derived.xpMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds 3.6 to xp for a medium gem with Soot 2 held", async () => {
  const posed = isolate(h);
  holdPassives(h, HELD);
  assertWithin(posed.run.xp, 0, FIGURE_TOLERANCE, "xp before the collection");
  const { player } = h.snapshot().run;
  spawnGemAt(h, TIER, player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "xp");

  assertLength(after.run.gems, 0, "gems left after the collecting tick");
  assertWithin(
    after.run.xp,
    GAIN,
    FIGURE_TOLERANCE,
    "xp after collecting a medium gem with Soot 2 held",
  );
});
