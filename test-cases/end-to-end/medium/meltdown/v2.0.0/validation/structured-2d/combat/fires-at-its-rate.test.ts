// combat/fires-at-its-rate — an emitter fires at its stated rate.
//
// specs/combat.md, The fire clock: an emitter that has a target and is online
// adds the frame's game time to a fire accumulator, and each time that
// accumulator reaches `1 / fireRate` one shot resolves and the interval is
// subtracted. A run of firing therefore lands its FIRST shot one full interval
// after the target was acquired — never on the frame the target appeared — and
// lands the rest at the tower's own rate from there.
//
// The Arc's rate is `2.0` shots a second (specs/towers.md), so its interval is
// half a second: the first shot half a second in, and ten shots by 5.25 s.
//
// Shots are counted off the target's hp, because hp is what a shot is FOR: one
// shot removes `baseDamage * heatMultiplier(H, redline)` (specs/combat.md,
// Damage), and the tower is posed at a heat that cannot drift, so that figure is
// the same for every shot of the run. The target is given far more hp than the
// run removes, so the reading is a subtraction rather than a death.

import { afterEach, beforeEach, it } from "vitest";
import {
  TOWER_DEFS,
  heatMultiplier,
  type EmitterDef,
} from "../../src/constants";
import { assertBetween, assertCloseTo, assertEqual, assertTruthy } from "../assert";
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

const ARC = TOWER_DEFS.arc as EmitterDef;

/**
 * A quiet footprint anchor: clear of the left corridor (rows 16..19) and of the
 * top one (columns 22..29), so the tower posed here lengthens neither route
 * (specs/floor.md).
 */
const SITE = { col: 4, row: 4 };

/**
 * Where the target stands: four tiles below the anchor, 3.5 tiles from the
 * footprint's centre — inside the Arc's level-I radius of 6.0 tiles
 * (specs/towers.md) and clear of the footprint itself.
 */
const TARGET_TILE = { col: 4, row: 8 };

/** specs/towers.md: the Arc fires 2.0 shots a second at level I. */
const INTERVAL = 1 / ARC.fireRate;

/** The heat the tower is pinned at, so the per-shot damage cannot drift. */
const PINNED_HEAT = 0;

/** specs/combat.md, Damage: what one of this tower's shots removes. */
const DAMAGE = ARC.baseDamage * heatMultiplier(PINNED_HEAT, ARC.redline);

/** The frame the first shot is due on: one full interval after the target. */
const FIRST_SHOT_TICKS = ticksFor(INTERVAL);

/**
 * How far the first shot's frame may sit from that: ONE frame.
 *
 * The accumulator is a sum of the deltas the frames handed the game, and whether
 * the sixtieth of them carries it to exactly half a second or leaves it a
 * floating-point hair short is a property of that addition rather than of the
 * rule. Nothing wider is needed: a build that fires on the frame the target
 * appeared, or at twice the rate, is a whole interval out.
 */
const TICK_SLACK = 1;

/**
 * The window the run is counted over, and the shots specs/combat.md puts in it.
 *
 * 5.25 s is ten and a half intervals, so the reading sits half an interval clear
 * of both the tenth shot and the eleventh and cannot turn on a rounding.
 */
const RUN_SECONDS = 5.25;
const RUN_SHOTS = 10;

/** More hp than the run removes, so the reading is a subtraction, not a death. */
const TARGET_HP = 10_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/** The target as the snapshot reports it; a target that has gone fails here. */
function targetNow(id: number): UnitSnapshot {
  const unit = unitById(harness.snapshot(), id);
  assertTruthy(unit, `the target unit ${id} still on the floor`);
  return unit as UnitSnapshot;
}

it("lands its first shot an interval in and fires at its rate after", async () => {
  startRun(harness);
  posePinnedTower(harness, "arc", SITE.col, SITE.row, PINNED_HEAT);
  const target = poseTarget(
    harness,
    "mote",
    TARGET_TILE.col,
    TARGET_TILE.row,
    TARGET_HP,
  );

  const first = await harness.until(
    (snapshot) => (unitById(snapshot, target)?.hp ?? 0) < TARGET_HP,
    { maxFrames: ticksFor(2 * INTERVAL) },
  );
  assertEqual(first.hit, true, "a first shot within two of the Arc's intervals");
  assertBetween(
    first.frames,
    FIRST_SHOT_TICKS - TICK_SLACK,
    FIRST_SHOT_TICKS + TICK_SLACK,
    `the frame the first shot landed on, ${INTERVAL}s at ${ARC.fireRate}/s`,
  );

  await harness.advance(ticksFor(RUN_SECONDS) - first.frames);
  captureStill(harness, "rate");

  assertCloseTo(
    targetNow(target).hp,
    TARGET_HP - RUN_SHOTS * DAMAGE,
    6,
    `hp after ${RUN_SECONDS}s, which is ${RUN_SHOTS} shots of ${DAMAGE}`,
  );
});
