// Wick — instrumentation/clear-gems: `clearGems()` with gems on the field
// leaves `gems` empty and `xp` exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `clearGems()`):
// "Removes every gem; no experience is gained."
//
// WHY THE WORLD IS POSED AS IT IS. Three gems of three tiers, and `xp` posed to
// a figure that is not `0`, so a clear that collected them would raise it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const POSED_XP = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every gem without experience", async () => {
  await isolate(h);
  await h.debug.setXp(POSED_XP);
  await placeGem(h, "small", 200, 0);
  await placeGem(h, "medium", -200, 0);
  await placeGem(h, "large", 0, 200);
  assertLength((await h.snapshot()).run.gems, 3, "the gems before the clear");

  await h.debug.clearGems();
  const after = await h.snapshot();
  await captureStill(h, "cleared");
  assertLength(after.run.gems, 0, "the gems after clearGems()");
  assertEqual(after.run.xp, POSED_XP, "xp across the clear");
});
