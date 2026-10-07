// Wick — instrumentation/set-level: `setLevel(4)` on `playing` reads back
// `level` 4 with `xpToNext` 35 and leaves `xp` exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setLevel(level)`: "Sets `level` to `level`, a whole number of at least
// `1`. `xp` is untouched." The derived table: `xpToNext` is
// `XP_BASE (5) + XP_STEP (10) × (level − 1)`, 35 at level 4.
//
// THE POSE. An isolated run with `xp` posed to 3 first, so an `xp` reset to 0
// or rescaled by the level pose is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { xpToNext } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_XP = 3;
const POSED_LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the level, derives xpToNext, and leaves xp alone", async () => {
  isolate(h);
  h.debug.setXp(POSED_XP);
  h.debug.setLevel(POSED_LEVEL);
  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "posed");

  assertEqual(run.level, POSED_LEVEL, "run.level after setLevel(4)");
  assertEqual(
    run.xpToNext,
    xpToNext(POSED_LEVEL),
    "run.xpToNext after setLevel(4)",
  );
  assertEqual(run.xp, POSED_XP, "run.xp after setLevel(4)");
});
