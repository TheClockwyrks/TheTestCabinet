// instrumentation/clear-gems — `clearGems()` with gems on the field leaves
// gems empty and xp exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearGems`:
// "Removes every gem; no experience is gained".
//
// THE POSE. An isolated run with xp posed to a figure a gain would move and
// three gems, one at the lamplighter's own center so a clear that collected
// would show; the clear; the read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

const HELD_XP = 2.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every gem without a gain", async () => {
  isolate(h);
  h.debug.setXp(HELD_XP);
  const { x, y } = h.snapshot().run.player;
  spawnGemAt(h, "small", x, y);
  spawnGemAt(h, "medium", x + 200, y);
  spawnGemAt(h, "large", x, y + 200);
  assertLength(h.snapshot().run.gems, 3, "the gems before the clear");

  h.debug.clearGems();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "cleared");

  assertLength(s.run.gems, 0, "the gems after the clear");
  assertEqual(s.run.xp, HELD_XP, "xp across the clear");
});
