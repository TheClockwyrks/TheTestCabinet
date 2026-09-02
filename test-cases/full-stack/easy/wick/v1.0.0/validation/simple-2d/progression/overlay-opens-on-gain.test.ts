// progression/overlay-opens-on-gain — a level-up queued by a gem collected in
// play brings the level-up overlay up, with its offers filled.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The level-up overlay: "A
// playing tick that ends with pendingLevelUps above 0 runs to completion and
// then opens the overlay: screen becomes levelup with menuIndex 0", and "The
// overlay offers OFFER_COUNT distinct candidates drawn uniformly at random from
// the pool". Phase 12 of specs/world.md, One tick, says the same: "a tick that
// ends with a level-up queued and no chest collected opens the level-up
// overlay". This point reads that the overlay ARRIVES in play at all; the
// stricter reading, that it arrives on the gain's own tick, is
// progression/overlay-opens-same-tick.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the run's only experience is the gem the
// scenario places. Level 1 and xp 4 are posed, one small gem
// (GEM_VALUES.small, 1, by specs/world.md) short of the XP_BASE (5) threshold,
// and the gem is placed at the lamplighter's center, where phase 9 of
// specs/world.md collects it on the next tick. Three playing frames are then
// run, which is the gain's tick and two more: "The simulation does not tick
// while it is open" (specs/progression.md), so a frame after the overlay opens
// advances nothing and the reading is the same however early the build opened
// it.
//
// THE TOLERANCE. None on the screen or the offers, both discrete. The two
// spare ticks are the tolerance: a build that opens the overlay one or two
// ticks after the gain still passes here.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import { LAMP_OIL_ID, XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The level the gain is read at, whose threshold is XP_BASE. */
const POSED_LEVEL = 1;

/** The experience posed: one small gem short of the threshold. */
const POSED_XP = XP_BASE - 1;

/** The gain's own tick and the two playing ticks the point allows after it. */
const TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands on levelup with its offers filled by the second playing tick after the gain", async () => {
  isolate(h);
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);

  const after = await h.tick(TICKS);
  captureStill(h, "opened");

  assertEqual(after.run.level, POSED_LEVEL + 1, "the gain that queued it");
  assertEqual(after.screen, "levelup", "the screen after the gain");
  assertGreaterThan(
    after.run.offers.length,
    0,
    "the offers the overlay filled",
  );
  for (const offer of after.run.offers) {
    if (offer === LAMP_OIL_ID) continue;
    assertContains(after.run.pool, offer, "an offer drawn from the pool");
  }
});
