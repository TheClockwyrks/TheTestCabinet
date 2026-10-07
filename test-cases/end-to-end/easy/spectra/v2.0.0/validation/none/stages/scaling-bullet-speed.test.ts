// stages/scaling-bullet-speed — a later stage's enemy fire falls faster.
//
// specs/stages.md, Scaling: `bulletSpeedScale(stage)` is
// `min(1.40, 1 + 0.04 * (stage - 1))`, and it multiplies "the enemy bullet speed"
// in specs/swarm.md, which fixes it at `ENEMY_BULLET_SPEED` (320) units per second
// "straight down". So enemy fire falls at 320 units a second at stage 1 and at
// `ENEMY_BULLET_SPEED * bulletSpeedScale(10)` — 435.2 — at stage 10.
//
// WHAT IS MEASURED, AND WHY IT IS TWO BULLETS RATHER THAN ONE. The rule is about
// the fire the SWARM takes, so each leg watches a diver cross `DIVE_FIRE_Y` and
// reads the shot it takes there. A build can scale the bullets it fires by one
// figure and the bullets `addEnemyBullet` places by another — they are two code
// paths, and only the first is the one a player meets — so the leg that decides
// this point is the fired one. `specs/instrumentation.md` then requires the placed
// bullet to carry the same figure, "`ENEMY_BULLET_SPEED` scaled for the current
// stage ... the same figure `snapshot().bulletSpeedScale` reports", so the placed
// bullet is read too and held to the same expectation. `swarm/enemy-bullet-speed`
// reads a placed bullet at stage 1 alone; the stage's own scaling is here.
//
// WHY THE READING IS ABSOLUTE AND NOT A RATIO. Each leg is asserted against the
// figure `specs/stages.md` fixes for THAT stage, restated in
// `validation/none/constants.ts`. A ratio between stage 10 and stage 1 is blind to
// a build running `1 + 0.04 * stage` rather than `1 + 0.04 * (stage - 1)`: it
// fires at 332.8 where the specification says 320 and at 448 where it says 435.2,
// and the two errors very nearly cancel between them. Read against the
// specification's own figures they are 4% and 2.9% out.
//
// WHY STAGE TEN. `bulletSpeedScale` reaches its 1.40 cap at stage 11, so ten is
// the last stage inside the ramp and `stages/scaling-bullet-speed-cap` is the point
// that decides where the cap lies. The stage-1 leg is not a control for a ratio any
// more — it is the other half of the ramp, read absolutely, and it is where the
// off-by-one model sits furthest out.
//
// WHAT IS POSED. An empty live wave, then one diver just above the fire line with
// its travel and its fire open, and afterwards one placed bullet high in the field.
// `startPosed` shuts the ship's contact test, so neither bullet is absorbed or paid
// for, and both are read well before `FIELD_BOTTOM` removes them.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, fail } from "../assert";
import {
  bulletSpeedScale,
  DIVE_FIRE_Y,
  ENEMY_BULLET_SPEED,
  FIELD_TOP,
  FORM_CENTER_X,
} from "../constants";
import {
  captureStill,
  createHarness,
  enemyBullets,
  framesFor,
  lastBullet,
  poseDrone,
  requireBullet,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the ramp is read at, and the stage it is read against. */
const LATE_STAGE = 10;
const BASE_STAGE = 1;

/** The units enemy fire falls in a second at `stage` (specs/stages.md). */
function expectedRate(stage: number): number {
  return ENEMY_BULLET_SPEED * bulletSpeedScale(stage);
}

/**
 * How long the fired bullet is watched, in seconds.
 *
 * Half a second. The shot is taken at `DIVE_FIRE_Y` (360) and the fastest leg
 * covers 218 units in that time, so it is read at about y = 578, still well above
 * the `FIELD_BOTTOM` (656) a bullet is removed at (`specs/field.md`). The reading
 * is divided by the window, so what both legs report is a speed rather than a
 * distance and the two windows need not match.
 */
const FIRED_FOR = 0.5;

/**
 * How long the placed bullet is watched, in seconds, and where it is dropped.
 *
 * A whole second, from just inside the top of the play field: the faster leg falls
 * 435 units and ends at about y = 509, again clear of `FIELD_BOTTOM`.
 */
const PLACED_FOR = 1;
const DROPPED_AT = { x: FORM_CENTER_X - 200, y: FIELD_TOP + 10 } as const;

/** Where the diver is posed: on the fire line's approach, off the ship's lane. */
const DIVER_AT = { x: FORM_CENTER_X + 96, y: DIVE_FIRE_Y - 100 } as const;

/**
 * Frames the sweep waits for the diver's shot.
 *
 * Two seconds. The diver is posed 100 units above the fire line and travels at
 * `DIVE_SPEED` or better, so it crosses within about a third of a second at the
 * slowest; the rest is room for a build whose dive path takes a longer way down to
 * the same line, and a build that never fires is named rather than hanging.
 */
const SHOT_FRAMES = framesFor(2);

/**
 * How far a measured speed may sit from the stated one, as a fraction.
 *
 * One and a half percent, and it is a measurement allowance rather than a licence
 * on the speed. Enemy fire falls straight down, so the reading is a difference of
 * two reported centres over a whole number of frames — there is no path to
 * approximate and no curvature to lose — and the reference builds read the stated
 * figure exactly.
 *
 * What the band decides is which wrong models this point names. A build that never
 * scales enemy fire reads 320 against a stage-10 expectation of 435.2, a quarter
 * below the band. A build one step out along the ramp reads 448 against 435.2 and
 * 332.8 against a stage-1 expectation of 320 — 2.9% and 4% out, both outside the
 * band, the second by a comfortable margin. The band is not widened toward the 5%
 * the ratio it replaces allowed, because at stage 10 the ramp and its own cap are
 * only 3% apart and a band that wide could not tell them from each other.
 */
const TOLERANCE = 0.015;

/**
 * Decimal places the derived bullet-speed scale itself must agree to.
 *
 * Six, which is exact for this purpose: `bulletSpeedScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. This is the REPORTED figure, a requirement of its own rather than
 * the evidence the measurements rest on.
 */
const SCALE_DIGITS = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Open an empty live wave at `stage`, and check the figure it reports there. */
async function poseStage(h: Harness, stage: number): Promise<void> {
  await h.debug.reset();
  await startPosed(h, { stage });
  assertCloseTo(
    (await h.snapshot()).bulletSpeedScale,
    bulletSpeedScale(stage),
    SCALE_DIGITS,
    `the bullet-speed scale the game derives at stage ${stage}, ` +
      `min(1.40, 1 + 0.04 * (stage - 1)) (specs/stages.md)`,
  );
}

/** Units a second the shot a diver takes at `stage` falls at. */
async function firedRate(
  h: Harness,
  stage: number,
  still: boolean,
): Promise<number> {
  await poseStage(h, stage);
  await poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    phase: "diving",
    travel: true,
    fire: true,
  });

  const shot = await h.until((snapshot) => enemyBullets(snapshot).length > 0, {
    maxFrames: SHOT_FRAMES,
    poll: 1,
  });
  const fired = enemyBullets(shot.snapshot)[0];
  if (fired === undefined) {
    fail(
      `an enemy bullet from the diver, which takes its shot as its centre crosses DIVE_FIRE_Y (${DIVE_FIRE_Y}) at stage ${stage} (specs/swarm.md)`,
      "no enemy bullet appeared while the diver crossed the fire line",
    );
  }

  await h.advance(framesFor(FIRED_FOR));
  if (still) await captureStill(h, "faster");
  const after = requireBullet(
    await h.snapshot(),
    fired.id,
    `reading the diver's shot ${FIRED_FOR} s after it was fired at stage ${stage}, which it is still in flight for at ${ENEMY_BULLET_SPEED} units a second or anything near it (specs/swarm.md)`,
  );
  return (after.y - fired.y) / FIRED_FOR;
}

/** Units a second a bullet `addEnemyBullet` places at `stage` falls at. */
async function placedRate(h: Harness, stage: number): Promise<number> {
  await poseStage(h, stage);
  await h.debug.addEnemyBullet(DROPPED_AT.x, DROPPED_AT.y, "magenta");

  const placed = lastBullet(await h.snapshot());
  if (placed === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      `the bullet roster was still empty after addEnemyBullet at stage ${stage}`,
    );
  }

  await h.advance(framesFor(PLACED_FOR));
  const after = requireBullet(
    await h.snapshot(),
    placed.id,
    `reading the placed enemy bullet ${PLACED_FOR} s after it was dropped at stage ${stage}, which it is still in flight for at ${ENEMY_BULLET_SPEED} units a second or anything near it (specs/swarm.md)`,
  );
  return (after.y - placed.y) / PLACED_FOR;
}

/** Hold one reading to `ENEMY_BULLET_SPEED * bulletSpeedScale(stage)`. */
function assertRate(rate: number, stage: number, what: string): void {
  const expected = expectedRate(stage);
  assertBetween(
    rate,
    expected * (1 - TOLERANCE),
    expected * (1 + TOLERANCE),
    `the units a second ${what} falls at stage ${stage} ` +
      `(${rate.toFixed(1)}), ENEMY_BULLET_SPEED * bulletSpeedScale(${stage}) ` +
      `= ${expected.toFixed(1)} (specs/stages.md, specs/swarm.md)`,
  );
}

it("drops stage-ten enemy fire at ENEMY_BULLET_SPEED * bulletSpeedScale(10)", async () => {
  const baseFired = await firedRate(harness, BASE_STAGE, false);
  const lateFired = await firedRate(harness, LATE_STAGE, true);
  const basePlaced = await placedRate(harness, BASE_STAGE);
  const latePlaced = await placedRate(harness, LATE_STAGE);

  assertRate(baseFired, BASE_STAGE, "the shot a diver takes");
  assertRate(lateFired, LATE_STAGE, "the shot a diver takes");
  assertRate(basePlaced, BASE_STAGE, "a placed enemy bullet");
  assertRate(latePlaced, LATE_STAGE, "a placed enemy bullet");
});
