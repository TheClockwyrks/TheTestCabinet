// Wick — instrumentation/snapshot-derived-stats: with Tallow 2, Brass 1,
// Bellows 3, and Lure 2 held and the level posed to 4, the snapshot reads
// `maxHp` 130, `armor` 1, `moveSpeed` 234, `pickupRadius` 72, and `xpToNext` 35.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape",
// the derived-fields table): "`xpToNext` | `XP_BASE` (`5`) `+ XP_STEP` (`10`)
// `× (level − 1)`"; "`maxHp` | `BASE_MAX_HP` (`100`) `+ TALLOW_HP_PER_LEVEL`
// (`15`) `×` the Tallow level held"; "`armor` | `BRASS_ARMOR_PER_LEVEL` (`1`)
// `×` the Brass level held"; "`moveSpeed` | `MOVE_SPEED` (`180`) `× (1 +
// BELLOWS_SPEED_PER_LEVEL` (`0.1`) `×` the Bellows level held`)`";
// "`pickupRadius` | `PICKUP_RADIUS` (`48`) `× (1 + LURE_PICKUP_PER_LEVEL`
// (`0.25`) `×` the Lure level held`)`". The figures are those formulas over the
// posed levels, through the same functions `constants.ts` states them as, and
// the tolerance is `FLOAT_TOL`: `180 × 1.3` is a product of two exact figures.
//
// WHY THE WORLD IS POSED AS IT IS. Four passives at four different levels, one
// per formula, so a build that reads the wrong slot or the wrong per-level term
// misses at least one figure; the level is posed to a value whose `xpToNext` is
// not the fresh run's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  armorOf,
  FLOAT_TOL,
  maxHpOf,
  moveSpeedOf,
  pickupRadiusOf,
  xpToNext,
  type PassiveLevels,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

const LEVELS: PassiveLevels = { tallow: 2, brass: 1, bellows: 3, lure: 2 };
const POSED_LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives maxHp, armor, moveSpeed, pickupRadius, and xpToNext from the loadout", async () => {
  await isolate(h);
  await holdPassive(h, "tallow", LEVELS.tallow);
  await holdPassive(h, "brass", LEVELS.brass);
  await holdPassive(h, "bellows", LEVELS.bellows);
  await holdPassive(h, "lure", LEVELS.lure);
  await h.debug.setLevel(POSED_LEVEL);
  const s = await h.snapshot();
  await captureStill(h, "stats");

  assertEqual(s.run.maxHp, maxHpOf(LEVELS), "maxHp with Tallow 2");
  assertEqual(s.run.armor, armorOf(LEVELS), "armor with Brass 1");
  assertNear(
    s.run.moveSpeed,
    moveSpeedOf(LEVELS),
    FLOAT_TOL,
    "moveSpeed with Bellows 3",
  );
  assertNear(
    s.run.pickupRadius,
    pickupRadiusOf(LEVELS),
    FLOAT_TOL,
    "pickupRadius with Lure 2",
  );
  assertEqual(s.run.xpToNext, xpToNext(POSED_LEVEL), "xpToNext at level 4");
});
