// Wick — instrumentation/clear-gems: `clearGems()` with gems on the field
// leaves `gems` empty and `xp` exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearGems()`: "Removes every gem; no experience is gained."
//
// THE POSE. An isolated run with `xp` posed to 4.5 and three gems, one of
// them inside the pickup radius and one attracted, so a clear that collected
// would show as a gain; the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const POSED_XP = 4.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes every gem and gains no experience", async () => {
  isolate(h);
  h.debug.setXp(POSED_XP);
  placeGem(h, "small", 20, 0);
  placeGem(h, "medium", 300, 0);
  const large = placeGem(h, "large", -300, 0);
  h.debug.setGemAttracted(large, true);
  assertLength(h.snapshot().run.gems, 3, "gems before the call");

  h.debug.clearGems();
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "cleared");
  assertDeepEqual(after.run.gems, [], "gems after clearGems");
  assertEqual(after.run.xp, POSED_XP, "run.xp after clearGems");
});
