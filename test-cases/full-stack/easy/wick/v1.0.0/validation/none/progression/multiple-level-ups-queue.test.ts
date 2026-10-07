// progression/multiple-level-ups-queue — one gem can queue several level-ups.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Levels and
// experience"): "After every gain, while `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1`, and one level-up is queued in
// `pendingLevelUps` ... one gem can queue several level-ups when it carries
// enough experience for them." The thresholds are `xpToNext(1)` (`5`) and
// `xpToNext(2)` (`15`), and specs/world.md gives a `small` gem `1` experience
// at `xpMul` `1`. So at level `1` with `xp` `19`, one small gem takes `xp` to
// `20`, which spends `5` and then `15`, leaving level `3`, `xp` `0`, and
// `pendingLevelUps` `2`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `progression` alone
// turned back on, which is the faculty that spends a gain on a level, and every
// other faculty held, nothing alive, and no passive, so the gain is exactly the
// gem's value. The
// experience is posed one short of the two thresholds together, so the smallest
// gem in the game crosses both at once: a build that loops its rule reads two,
// and a build that applies it once reads one.
//
// THE TOLERANCE. `level` and `pendingLevelUps` are whole numbers, read exactly;
// `xp` is "a real number", so it is read within `FLOAT_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, GEM_VALUES, xpToNext } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The level the crossings are read from: the first. */
const POSED_LEVEL = 1;

/** One short of the first two thresholds together, so one small gem crosses both. */
const POSED_XP =
  xpToNext(POSED_LEVEL) + xpToNext(POSED_LEVEL + 1) - GEM_VALUES.small;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("crosses both thresholds on one gem and queues two level-ups", async () => {
  await isolate(h, { on: ["progression"] });
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);

  const after = await collectGem(h, "small");
  await captureStill(h, "queued");

  assertEqual(after.run.level, POSED_LEVEL + 2, "the level after the gain");
  assertNear(after.run.xp, 0, FLOAT_TOL, "the experience after the gain");
  assertEqual(after.run.pendingLevelUps, 2, "the level-ups queued by one gem");
});
