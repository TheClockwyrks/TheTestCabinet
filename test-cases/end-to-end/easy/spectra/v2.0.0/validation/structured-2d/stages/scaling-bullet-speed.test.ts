// stages/scaling-bullet-speed — a later stage's enemy fire falls faster.
//
// specs/stages.md, Scaling: `bulletSpeedScale(stage)` is
// `min(1.40, 1 + 0.04 * (stage - 1))`, and it multiplies "the enemy bullet speed"
// in specs/swarm.md, which fixes it at `ENEMY_BULLET_SPEED` (320) units per second
// "straight down". specs/instrumentation.md states that `addEnemyBullet` places a
// bullet "traveling straight down at `ENEMY_BULLET_SPEED` scaled for the current
// stage", so the bullet a pose puts in flight carries the stage's own figure.
//
// WHY STAGE TEN. `bulletSpeedScale` reaches its 1.40 cap at stage 11, so ten is
// the last stage inside the ramp and the one where the ramp is steepest against
// the cap: the stated ratio is 1.36, a build that does not scale enemy fire reads
// 1.00, and a build that had already capped reads 1.40. The 5% band the manifest
// sets — 0.068 either side of 1.36 — separates the first cleanly and leaves the
// second just inside, which is honest: at stage 10 the ramp and the cap really are
// only 3% apart, and `stages/scaling-bullet-speed-cap` is the point that decides
// where the cap lies.
//
// WHAT IS MEASURED. One bullet's fall over one second, read as the change in its
// `y`. It falls straight down, so the displacement IS the distance; nothing about
// a path is involved and nothing needs summing. The bullet is placed just under
// the top of the play field and the window is short enough that even the faster
// leg is still well inside the field at the end, so neither leg is measuring a
// bullet that has been removed.
//
// WHAT IS POSED. An empty live wave and one enemy bullet. `startPosed` shuts the
// ship's contact test, so the bullet is not absorbed or paid for; it is placed
// clear of the ship's lane in any case, and nothing else is on the field to stop
// it.

import { afterEach, beforeEach, it } from "vitest";
import {
  bulletSpeedScale,
  ENEMY_BULLET_SPEED,
  FIELD_TOP,
  FORM_CENTER_X,
} from "../../src/constants";
import { assertBetween, assertCloseTo, fail } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  poseEnemyBullet,
  resetTo,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the ramp is read at, and the stage it is read against. */
const LATE_STAGE = 10;
const BASE_STAGE = 1;

/** What `specs/stages.md` says the late stage's fire covers, per the base stage's. */
const EXPECTED_RATIO =
  bulletSpeedScale(LATE_STAGE) / bulletSpeedScale(BASE_STAGE);

/**
 * How far the measurement runs, in seconds.
 *
 * The manifest's own window: "the distance in a second". A second of fall is 320
 * units at stage 1 and 435 at stage 10; from `DROPPED_AT` the faster of the two
 * ends at y = 509, well above `FIELD_BOTTOM` (656), so the bullet is still on the
 * field when it is read.
 */
const MEASURED_FOR = 1;

/** Where the bullet is dropped: just inside the top of the play field, off the lane. */
const DROPPED_AT = { x: FORM_CENTER_X - 200, y: FIELD_TOP + 10 } as const;

/**
 * How far the measured ratio may sit from the stated one, as a fraction.
 *
 * The manifest's own figure. The measurement is far tighter than the band: the
 * fall is straight, the frames are counted exactly, and any error in where inside
 * a frame the bullet started falls on both legs alike. What the 5% band decides is
 * which wrong models this point names — a build that never scales enemy fire reads
 * 1.00, a quarter below the band — and it is deliberately not tightened further,
 * because at stage 10 the honest distance between the ramp and its own cap is only
 * 3%.
 */
const TOLERANCE = 0.05;

/**
 * Decimal places the derived bullet-speed scale itself must agree to.
 *
 * Six, which is exact for this purpose: `bulletSpeedScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. Reading it at the stage this point works at is what separates a
 * ramp that runs one step ahead of the stated one — a build using
 * `1 + 0.04 * stage` reads 1.40 where the specification says
 * 1.36, which the band above admits and this does not, and
 * `stages/scaling-bullet-speed-cap` reads the same field only where the formula has
 * saturated and every ramp reads alike.
 */
const SCALE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** How far one posed enemy bullet falls in `MEASURED_FOR` seconds, at `stage`. */
async function fallAt(harness: Harness, stage: number): Promise<number> {
  resetTo(harness);
  startPosed(harness);
  harness.debug.setStage(stage);
  assertCloseTo(
    harness.snapshot().bulletSpeedScale,
    bulletSpeedScale(stage),
    SCALE_DIGITS,
    `the bullet-speed scale the game derives at stage ${String(stage)}, ` +
      "min(1.40, 1 + 0.04 * (stage - 1)) (specs/stages.md), which is the figure " +
      "the reading below has to be taken under",
  );
  const id = poseEnemyBullet(harness, DROPPED_AT.x, DROPPED_AT.y, "magenta");

  const placed = bulletById(harness.snapshot(), id);
  if (placed === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      `the bullet roster was still empty after addEnemyBullet at stage ${stage}`,
    );
  }

  await harness.advance(ticksFor(MEASURED_FOR));
  const after = bulletById(harness.snapshot(), id);
  if (after === undefined) {
    fail(
      `the enemy bullet still in flight ${MEASURED_FOR} s after it was dropped at stage ${stage}, which it is at ${ENEMY_BULLET_SPEED} units a second or anything near it (specs/swarm.md)`,
      "no bullet with that id is on the field",
    );
  }
  return after.y - placed.y;
}

it("drops stage-ten enemy fire bulletSpeedScale(10) times as far in a second", async () => {
  const base = await fallAt(h, BASE_STAGE);
  const late = await fallAt(h, LATE_STAGE);
  captureStill(h, "faster");

  assertBetween(
    late / base,
    EXPECTED_RATIO * (1 - TOLERANCE),
    EXPECTED_RATIO * (1 + TOLERANCE),
    `the ground stage-${LATE_STAGE} enemy fire covers in a second over stage-${BASE_STAGE} fire's, bulletSpeedScale(${LATE_STAGE}) (specs/stages.md)`,
  );
});
