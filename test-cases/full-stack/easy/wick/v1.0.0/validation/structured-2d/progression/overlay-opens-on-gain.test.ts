// Wick — progression/overlay-opens-on-gain: a level-up queued by a gain in
// play opens the level-up overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// level-up overlay": "A `playing` tick that ends with `pendingLevelUps` above
// `0` runs to completion and then opens the overlay: `screen` becomes
// `levelup` with `menuIndex` `0`", and "The overlay offers `OFFER_COUNT`
// distinct candidates drawn ... from the pool". `specs/world.md`, phase 12:
// "a tick that ends with a level-up queued and no chest collected opens the
// level-up overlay".
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `4`, and one small gem on the lamplighter's own center, so the gain is real
// rather than a posed queue. Three ticks are run: the gain lands on the first,
// and two more follow, which is the latest the overlay can have opened by and
// still be in play at all. Further ticks change nothing either way, since "the
// simulation does not tick while it is open"; the exact tick the overlay opens
// on is a separate requirement. Holding nothing
// leaves every base weapon and every passive a candidate
// (`specs/progression.md`, "The candidate pool"), so the pool is far larger
// than `OFFER_COUNT` and the draw is filled.
//
// THE TOLERANCE. Exact: a screen name, and the count of drawn offers.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const LEVEL = 1;
const XP_BEFORE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stands on levelup with its offers drawn within three ticks of the gain", async () => {
  const { player } = isolate(h).run;
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placeGem(h, "small", player.x, player.y);

  const after = await advanceTicks(h, 3);
  captureStill(h, "opened");

  assertEqual(
    after.screen,
    "levelup",
    "screen three ticks after the gain that queued a level-up",
  );
  assertLength(
    after.run.offers,
    OFFER_COUNT,
    "run.offers on the opened overlay (specs/progression.md, The draw)",
  );
  for (const offer of after.run.offers) {
    assertContains(after.run.pool, offer, `offer ${offer} within run.pool`);
  }
});
