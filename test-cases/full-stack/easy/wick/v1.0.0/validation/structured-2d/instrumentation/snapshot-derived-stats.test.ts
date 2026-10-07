// Wick — instrumentation/snapshot-derived-stats: the snapshot derives the
// lamplighter's stats from the loadout.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// table under "Snapshot shape", "Nine are derived rather than stored":
//   `xpToNext`     = XP_BASE (5) + XP_STEP (10) × (level − 1)       → 35 at level 4
//   `maxHp`        = BASE_MAX_HP (100) + TALLOW_HP_PER_LEVEL (15) × Tallow → 130 at 2
//   `armor`        = BRASS_ARMOR_PER_LEVEL (1) × Brass                → 1 at 1
//   `moveSpeed`    = MOVE_SPEED (180) × (1 + 0.1 × Bellows)           → 234 at 3
//   `pickupRadius` = PICKUP_RADIUS (48) × (1 + 0.25 × Lure)           → 72 at 2
// The same formulas stand in `specs/passives.md`, restated in `constants.ts`.
//
// THE POSE. An isolated run with the four passives placed through `setPassive`
// and the level posed to 4. Nothing ticks: "`maxHp`, `armor`, `moveSpeed`,
// `pickupRadius`, and every multiplier follow from the next read"
// (`setPassive`), so the read after the pose is the read.
//
// TOLERANCE. `REAL_EPS` on the two products; the sums are exact in floating
// point at these figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  REAL_EPS,
  armorOf,
  maxHpOf,
  moveSpeedOf,
  pickupRadiusOf,
  xpToNext,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

const TALLOW = 2;
const BRASS = 1;
const BELLOWS = 3;
const LURE = 2;
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads maxHp 130, armor 1, moveSpeed 234, pickupRadius 72, xpToNext 35", async () => {
  isolate(h);
  holdPassive(h, "tallow", TALLOW);
  holdPassive(h, "brass", BRASS);
  holdPassive(h, "bellows", BELLOWS);
  holdPassive(h, "lure", LURE);
  h.debug.setLevel(LEVEL);

  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "stats");

  assertEqual(run.maxHp, maxHpOf(TALLOW), "run.maxHp with Tallow 2");
  assertEqual(run.armor, armorOf(BRASS), "run.armor with Brass 1");
  assertNear(
    run.moveSpeed,
    moveSpeedOf(BELLOWS),
    REAL_EPS,
    "run.moveSpeed with Bellows 3",
  );
  assertNear(
    run.pickupRadius,
    pickupRadiusOf(LURE),
    REAL_EPS,
    "run.pickupRadius with Lure 2",
  );
  assertEqual(run.xpToNext, xpToNext(LEVEL), "run.xpToNext at level 4");
});
