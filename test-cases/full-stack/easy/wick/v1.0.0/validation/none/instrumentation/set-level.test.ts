// Wick — instrumentation/set-level: `setLevel(4)` on `playing` reads back
// `level` 4 with `xpToNext` 35 and leaves `xp` exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setLevel(level)`):
// "Sets `level` to `level`, a whole number of at least `1`. `xp` is untouched."
// `xpToNext` is "`XP_BASE` (`5`) `+ XP_STEP` (`10`) `× (level − 1)`", 35 at
// level 4.
//
// WHY THE WORLD IS POSED AS IT IS. `xp` is posed to a figure that is not `0`
// first, so "untouched" is told from "reset"; the level is posed from the
// harness's isolated level, so the read is of the call's own value.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { xpToNext } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const POSED_LEVEL = 4;
const POSED_XP = 3.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the level alone", async () => {
  await isolate(h);
  await h.debug.setXp(POSED_XP);

  await h.debug.setLevel(POSED_LEVEL);
  const posed = await h.snapshot();
  await captureStill(h, "posed");

  assertEqual(posed.run.level, POSED_LEVEL, "level after setLevel(4)");
  assertEqual(posed.run.xpToNext, xpToNext(POSED_LEVEL), "xpToNext at the posed level");
  assertEqual(posed.run.xp, POSED_XP, "xp across setLevel");
});
