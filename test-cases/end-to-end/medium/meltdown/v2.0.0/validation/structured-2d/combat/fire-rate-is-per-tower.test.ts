// combat/fire-rate-is-per-tower — each tower's rate is its own.
//
// specs/combat.md fixes ONE fire clock rule and specs/towers.md gives each
// emitter a rate of its own to run it at, so the interval a tower fires on is
// `1 / fireRate` for THAT tower: the Stutter's 7.0 shots a second against the
// Lance's 0.8. A build that resolved one rate for every emitter — the Arc's, or
// an average — passes `fires-at-its-rate` and fails here, which is the whole
// point of measuring two towers that sit at the far ends of the roster.
//
// The two stand far enough apart that neither can reach the other's target: the
// Lance's radius is 12 tiles and the towers are 36 apart, so each reading counts
// its own tower's shots and nothing else. Both are pinned at a heat that cannot
// drift, so the per-shot damage the count is read through is fixed, and both
// targets carry far more hp than the run removes.

import { afterEach, beforeEach, it } from "vitest";
import {
  TOWER_DEFS,
  heatMultiplier,
  type EmitterDef,
} from "../../src/constants";
import { assertCloseTo, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  ticksFor,
  unitById,
  type Harness,
  type UnitSnapshot,
} from "../harness";

const STUTTER = TOWER_DEFS.stutter as EmitterDef;
const LANCE = TOWER_DEFS.lance as EmitterDef;

/**
 * Two quiet footprint anchors, each clear of the left corridor (rows 16..19) and
 * of the top one (columns 22..29) (specs/floor.md), and 30 columns apart so the
 * Lance's 12-tile radius cannot reach the Stutter's target.
 */
const STUTTER_SITE = { col: 4, row: 4 };
const LANCE_SITE = { col: 34, row: 24 };

/**
 * Each target stands four tiles below its tower's anchor: 3.5 tiles from the
 * Stutter's footprint centre against a 5.0-tile radius, and 2.9 tiles from the
 * Lance's against a 12.0-tile one (specs/towers.md).
 */
const STUTTER_TARGET = { col: 4, row: 8 };
const LANCE_TARGET = { col: 34, row: 28 };

/** The heat both towers are pinned at, so neither's damage can drift. */
const PINNED_HEAT = 0;

const STUTTER_DAMAGE =
  STUTTER.baseDamage * heatMultiplier(PINNED_HEAT, STUTTER.redline);
const LANCE_DAMAGE =
  LANCE.baseDamage * heatMultiplier(PINNED_HEAT, LANCE.redline);

/**
 * The window both runs are counted over.
 *
 * 5.5 s is 38.5 of the Stutter's intervals and 4.4 of the Lance's, so both
 * counts sit clear of a shot boundary on either side — the Stutter's nearest is
 * 0.07 s away and the Lance's 0.5 s — and neither reading can turn on a
 * floating-point rounding of the accumulator.
 */
const RUN_SECONDS = 5.5;
const STUTTER_SHOTS = Math.floor(RUN_SECONDS * STUTTER.fireRate);
const LANCE_SHOTS = Math.floor(RUN_SECONDS * LANCE.fireRate);

/** More hp than either run removes, so each reading is a subtraction. */
const TARGET_HP = 10_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/** The unit as the snapshot reports it; a unit that has gone fails here. */
function unitNow(id: number): UnitSnapshot {
  const unit = unitById(harness.snapshot(), id);
  assertTruthy(unit, `the target unit ${id} still on the floor`);
  return unit as UnitSnapshot;
}

it("gives the Stutter and the Lance each its own interval", async () => {
  startRun(harness);
  posePinnedTower(
    harness,
    "stutter",
    STUTTER_SITE.col,
    STUTTER_SITE.row,
    PINNED_HEAT,
  );
  posePinnedTower(
    harness,
    "lance",
    LANCE_SITE.col,
    LANCE_SITE.row,
    PINNED_HEAT,
  );
  const stutterTarget = poseTarget(
    harness,
    "mote",
    STUTTER_TARGET.col,
    STUTTER_TARGET.row,
    TARGET_HP,
  );
  const lanceTarget = poseTarget(
    harness,
    "mote",
    LANCE_TARGET.col,
    LANCE_TARGET.row,
    TARGET_HP,
  );

  await harness.advance(ticksFor(RUN_SECONDS));
  captureStill(harness, "rates");

  assertCloseTo(
    unitNow(stutterTarget).hp,
    TARGET_HP - STUTTER_SHOTS * STUTTER_DAMAGE,
    6,
    `the Stutter's target after ${RUN_SECONDS}s: ${STUTTER_SHOTS} shots at ` +
      `${STUTTER.fireRate}/s`,
  );
  assertCloseTo(
    unitNow(lanceTarget).hp,
    TARGET_HP - LANCE_SHOTS * LANCE_DAMAGE,
    6,
    `the Lance's target after ${RUN_SECONDS}s: ${LANCE_SHOTS} shots at ` +
      `${LANCE.fireRate}/s`,
  );
});
