// Wick — progression/overflow-carries: experience past the threshold carries
// into the next level.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Levels and
// experience": "`xp` falls by `xpToNext(level)`, `level` rises by `1` ... The
// overflow carries into the next level", with `xpToNext(1)` `5` and
// `xpToNext(2)` `15`. `specs/world.md`, "Attraction and flight": a collected
// gem raises `xp` by `GEM_VALUES[tier] × xpMul`, `xpMul` "is `1` with no Soot
// held"; `GEM_VALUES.medium` is `3`.
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `4`, and one medium gem on the lamplighter's own center. `4 + 3` is `7`,
// which passes `xpToNext(1)` by `2`, and `2` is below `xpToNext(2)`, so
// exactly one level is taken and `2` is left standing. A build that zeroes
// `xp` on a level-up reads `0` here; a build that subtracts nothing reads `7`.
// `progression` is the one driver switch turned on, since spending a gain on
// a level is what this point decides; the other eight are off and the world is
// otherwise empty, so the only gain is that gem's.
//
// THE TOLERANCE. `REAL_EPS` on `xp`, a real number that is here a difference
// of whole numbers; `level` is whole and exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GEM_VALUES, REAL_EPS, xpToNext } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const LEVEL = 1;
const XP_BEFORE = 4;
/** What the specification leaves standing: `4 + 3 − xpToNext(1)`. */
const XP_AFTER = XP_BEFORE + GEM_VALUES.medium - xpToNext(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves 2 experience on level 2 when a medium gem passes the threshold by 2", async () => {
  // `progression`, the faculty that spends a gain on levels, is the one
  // switch this point is about, so it is turned back on and the other eight
  // stay held (`specs/instrumentation.md`, the switch table).
  const { player } = isolate(h).run;
  enable(h, "progression");
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placeGem(h, "medium", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "overflow");

  assertEqual(
    after.run.level,
    LEVEL + 1,
    "run.level after a gain of 3 from xp 4 (specs/progression.md)",
  );
  assertNear(
    after.run.xp,
    XP_AFTER,
    REAL_EPS,
    "run.xp carried into the next level",
  );
});
