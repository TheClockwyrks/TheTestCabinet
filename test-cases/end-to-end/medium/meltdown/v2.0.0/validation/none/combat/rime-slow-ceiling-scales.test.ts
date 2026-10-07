// Meltdown — combat/rime-slow-ceiling-scales: upgrading raises the cold-slow
// ceiling.
//
// `specs/combat.md`: "`slowCeil` is `RIME_SLOW_CEIL` at the Rime's level: `0.55`,
// `0.68`, or `0.80`", and `specs/towers.md` repeats the three figures beside the
// four an upgrade moves. At heat `0` the fade term `1 - H / 100` is `1`, so the
// slow a cold Rime applies IS its ceiling, and the three levels must land three
// different slows.
//
// THE SLOW IS READ OFF THE UNIT, NOT OFF THE TOWER, and that is the difference
// between this point and `combat/rime-slow-degrades-with-heat`. That one reads the
// tower's own live `slowFactor` across the heat scale; this one reads what actually
// reaches a target after a shot at each of the three levels, so a build whose
// ceiling table is right and whose upgrade never reaches the shot fails here and
// not there.
//
// THREE LEVELS, BECAUSE ONE CEILING CANNOT TELL A TABLE FROM A CONSTANT. A build
// that ignores the level reads `0.55` three times; one that applied the damage
// multiplier `UPGRADE_DAMAGE` of `1.6` to the ceiling instead of the tabulated
// figures reads `0.55`, `0.88`, `1.408` — the second of which is `0.2` clear of the
// specified `0.68` and the third of which slows a unit to a standstill and past it;
// one that scaled by the fire-rate multiplier `1.15` reads `0.55`, `0.6325`,
// `0.7274`, which is close enough to demand exactly the tolerance stated below.
//
// EACH LEVEL IS A FRESH POSE, so every reading is taken on a unit carrying no slow
// at all — an incoming slow resolves against the live one in three cases
// (`specs/combat.md`), and those are `combat/slow-*`'s items rather than this
// point's. A fresh pose also opens each emitter's fire clock at zero, so each drive
// lands exactly one shot at that level's own rate.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  requireUnit,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  slowCeilOf,
} from "./duel";

/** The one emitter that slows (`specs/towers.md`), pinned cold. */
const TOWER = "rime";
const HEAT = 0;
const MARK = "mote";

/** The three levels `specs/towers.md` gives a tower. */
const LEVELS: readonly number[] = [1, 2, 3];

/**
 * How close each ceiling must come, as decimal places of a slow fraction.
 *
 * Three places is `0.0005`. The figure is a tabulated constant multiplied by `1`,
 * so a conformant build reads it exactly; the bound is set by the nearest wrong
 * model rather than by any need of a right one — the fire-rate multiplier applied
 * to the ceiling reads `0.6325` at level II, which is `0.0475` from the specified
 * `0.68`, a hundred times the bound.
 */
const CEILING_DIGITS = 3;

/** The slow a cold Rime at `level` lands on a fresh mark. */
async function appliedSlow(harness: Harness, level: number): Promise<number> {
  await poseGun(harness, TOWER, HEAT, level);
  const mark = await poseMarkEast(harness, TOWER, MARK, NEAR_UNITS);
  await harness.advance(framesForShots(1, fireRateOf(TOWER, level)));
  return requireUnit(
    await harness.snapshot(),
    mark,
    `the mark after one level-${level} ${TOWER} shot`,
  ).slowFactor;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Upgrading raises the cold-slow ceiling", async () => {
  const applied: number[] = [];
  for (const level of LEVELS) applied.push(await appliedSlow(h, level));
  await captureStill(h, "ceiling");

  for (const [index, level] of LEVELS.entries()) {
    assertCloseTo(
      applied[index],
      slowCeilOf(level),
      CEILING_DIGITS,
      `the slow a cold level-${level} ${TOWER} landed on a ${MARK}`,
    );
  }
});
