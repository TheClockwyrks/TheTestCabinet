// progression/overflow-carries — overflow experience carries into the next level.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Levels and
// experience"): "After every gain, while `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1` ... The overflow carries into the
// next level." `xpToNext(1)` is `XP_BASE` (`5`), and specs/world.md ("Gems")
// gives a `medium` gem `3` experience, raised by `xpMul`, which is "`1` with no
// Soot held". So at level `1` with `xp` `4`, one medium gem takes `xp` to `7`,
// `5` is spent on the level, and `2` is left standing at level `2` rather than
// discarded.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `progression` alone
// turned back on, which is the faculty that spends a gain on a level, and every
// other faculty held, nothing alive, and no passive, so the gem is worth
// exactly its tier's value.
// The gain is a real collection by a real tick. The medium gem is chosen
// because its value is neither the threshold nor a divisor of it, so a build
// that discards the remainder reads `0` and a build that never spends the
// threshold reads `7`.
//
// THE TOLERANCE. `level` is a whole number, read exactly; `xp` is "a real
// number", so it is read within `FLOAT_TOL`.

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

/** The level the crossing is read at: the first, whose threshold is `XP_BASE`. */
const POSED_LEVEL = 1;

/** The experience posed: one short of the threshold, so a medium gem overshoots by 2. */
const POSED_XP = xpToNext(POSED_LEVEL) - 1;

/** What the gain leaves standing: the gem's value less the threshold it spent. */
const CARRIED = POSED_XP + GEM_VALUES.medium - xpToNext(POSED_LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the experience past the threshold at the new level", async () => {
  await isolate(h, { on: ["progression"] });
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);

  const after = await collectGem(h, "medium");
  await captureStill(h, "overflow");

  assertEqual(after.run.level, POSED_LEVEL + 1, "the level after the gain");
  assertNear(
    after.run.xp,
    CARRIED,
    FLOAT_TOL,
    "the experience carried into the new level",
  );
});
