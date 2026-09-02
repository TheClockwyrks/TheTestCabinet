// Wick — progression/level-up-at-threshold: experience reaching `xpToNext`
// takes a level.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Levels and
// experience": "After every gain, while `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1`, and one level-up is queued in
// `pendingLevelUps`", with `xpToNext(1)` `5`. `specs/world.md`, "Attraction and
// flight": a gem within `COLLECT_RADIUS` "is collected on that tick: it is
// removed, and `xp` rises by `GEM_VALUES[tier] × xpMul`", and `xpMul` "is `1`
// with no Soot held"; `GEM_VALUES.small` is `1`.
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `4`, and one small gem placed on the lamplighter's own center so the tick's
// gem phase collects it: `4 + 1` reaches `xpToNext(1)`, exactly, so the level
// is taken with nothing left over. Every driver switch is off and the world is
// otherwise empty, so the gain the tick reports is that one gem's and nothing
// else's. No passive is held, so `xpMul` is `1`.
//
// THE TOLERANCE. `level` and `pendingLevelUps` are whole and exact; `REAL_EPS`
// on `xp`, which the specification makes a real number and which is here a
// difference of two whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The level posed, and the experience posed just short of leaving it. */
const LEVEL = 1;
const XP_BEFORE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes level 2 with xp 0 and one level-up queued when a small gem reaches the threshold", async () => {
  const { player } = isolate(h).run;
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placeGem(h, "small", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "levelup");

  assertEqual(
    after.run.level,
    LEVEL + 1,
    "run.level after the gem crossing xpToNext(1) (specs/progression.md)",
  );
  assertNear(
    after.run.xp,
    0,
    REAL_EPS,
    "run.xp after the threshold is crossed",
  );
  assertEqual(
    after.run.pendingLevelUps,
    1,
    "run.pendingLevelUps after one level is taken",
  );
});
