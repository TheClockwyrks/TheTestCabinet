// Wick — progression/multiple-level-ups-queue: one gem can queue several
// level-ups.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Levels and
// experience": "After every gain, WHILE `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1`, and one level-up is queued in
// `pendingLevelUps` ... one gem can queue several level-ups when it carries
// enough experience for them", with `xpToNext(1)` `5` and `xpToNext(2)` `15`.
// `GEM_VALUES.small` is `1` and `xpMul` is `1` with no Soot held
// (`specs/world.md`, `specs/passives.md`).
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `19`, and one small gem on the lamplighter's own center. `19 + 1` is `20`,
// which is `xpToNext(1)` plus `xpToNext(2)` exactly: the loop runs twice and
// stops with nothing left. A build that applies the rule once reads level `2`
// with `xp` `15` and one queued.
//
// THE TOLERANCE. `level` and `pendingLevelUps` are whole and exact; `REAL_EPS`
// on `xp`, a real number that is here a difference of whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, xpToNext } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const LEVEL = 1;
/** `xpToNext(1) + xpToNext(2) − GEM_VALUES.small`: one gem short of two levels. */
const XP_BEFORE = 19;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes two levels and queues two level-ups from one small gem", async () => {
  if (XP_BEFORE + 1 !== xpToNext(LEVEL) + xpToNext(LEVEL + 1)) {
    throw new Error("the posed experience must reach exactly two thresholds");
  }
  const { player } = isolate(h).run;
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placeGem(h, "small", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "queued");

  assertEqual(
    after.run.level,
    LEVEL + 2,
    "run.level after a gain carrying two thresholds (specs/progression.md)",
  );
  assertNear(after.run.xp, 0, REAL_EPS, "run.xp after both levels are taken");
  assertEqual(
    after.run.pendingLevelUps,
    2,
    "run.pendingLevelUps after two levels are taken",
  );
});
