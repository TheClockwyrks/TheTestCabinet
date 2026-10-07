// instrumentation/snapshot-derived-stats — with Tallow 2, Brass 1, Bellows 3,
// and Lure 2 held and the level posed to 4, the snapshot reads maxHp 130,
// armor 1, moveSpeed 234, pickupRadius 72, and xpToNext 35.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table under "Snapshot shape":
//   xpToNext     = XP_BASE (5) + XP_STEP (10) × (level − 1)        → 35 at level 4
//   maxHp        = BASE_MAX_HP (100) + TALLOW_HP_PER_LEVEL (15) × Tallow → 130
//   armor        = BRASS_ARMOR_PER_LEVEL (1) × Brass                 → 1
//   moveSpeed    = MOVE_SPEED (180) × (1 + BELLOWS_SPEED_PER_LEVEL (0.1) × Bellows) → 234
//   pickupRadius = PICKUP_RADIUS (48) × (1 + LURE_PICKUP_PER_LEVEL (0.25) × Lure)   → 72
// each spelled in `constants.ts` exactly as the spec spells it, and read here
// at FIGURE_TOLERANCE since two of them are products of a decimal figure.
//
// THE POSE. An isolated run, the four passives through `setPassive`, the level
// through `setLevel`; nothing ticks, because "`maxHp`, `armor`, `moveSpeed`,
// `pickupRadius`, and every multiplier follow from the next read"
// (`setPassive`). Whether the stats ACT on the game (a faster walk, a wider
// pull) belongs to the passives' own points; this reads the derivation alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  derived,
  FIGURE_TOLERANCE,
  moveSpeedFor,
  pickupRadiusFor,
  xpToNext,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

const HELD = { tallow: 2, brass: 1, bellows: 3, lure: 2 } as const;
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the five derived stats off the posed loadout and level", async () => {
  isolate(h, { level: LEVEL });
  holdPassive(h, "tallow", HELD.tallow);
  holdPassive(h, "brass", HELD.brass);
  holdPassive(h, "bellows", HELD.bellows);
  holdPassive(h, "lure", HELD.lure);
  const { run } = h.snapshot();
  await h.tick(1);
  captureStill(h, "stats");

  assertEqual(run.level, LEVEL, "the posed level");
  assertEqual(run.xpToNext, xpToNext(LEVEL), "xpToNext at level 4");
  assertEqual(run.maxHp, derived.maxHp(HELD), "maxHp with Tallow 2");
  assertEqual(run.armor, derived.armor(HELD), "armor with Brass 1");
  assertWithin(
    run.moveSpeed,
    moveSpeedFor(HELD),
    FIGURE_TOLERANCE,
    "moveSpeed with Bellows 3",
  );
  assertWithin(
    run.pickupRadius,
    pickupRadiusFor(HELD),
    FIGURE_TOLERANCE,
    "pickupRadius with Lure 2",
  );
});
