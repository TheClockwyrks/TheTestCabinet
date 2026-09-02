// stages/scaling-drone-speed — a later stage's drones move faster.
//
// specs/stages.md, Scaling: `droneSpeedScale(stage)` is
// `min(1.50, 1 + 0.06 * (stage - 1))`, and it "multiplies the entrance and dive
// speeds in specs/swarm.md". specs/swarm.md fixes the stage-1 dive speed at
// `DIVE_SPEED` (300) units per second "along that path". So the ground one dive
// covers in a second at stage 5 is `droneSpeedScale(5)` — 1.24 — times the ground
// the same dive covers at stage 1.
//
// WHY STAGE FIVE. It is inside the ramp. The formula saturates at its 1.50 cap by
// stage 10, so a check posed at a later stage would be asserting the same figure
// `stages/scaling-drone-speed-cap` already asserts and the per-stage ramp would go
// ungraded. At stage 5 the three wrong models each read differently: a build that
// does not scale reads 1.00, one that jumped straight to the cap reads 1.50, and
// one that scales by 0.06 per stage rather than per stage ABOVE THE FIRST reads
// 1.30.
//
// WHAT IS MEASURED, AND WHY IT IS A RATE RATHER THAN A DISTANCE. The dive's own
// PATH is the build's design — `specs/swarm.md` fixes only the speed along it —
// so the distance covered is summed frame by frame along whatever path the build
// flew, and divided by the game time it took. That makes the reading the speed the
// specification states rather than a demand on where the dive went, and it lets
// the two legs be compared even if one build's dive ends sooner than another's.
//
// WHAT IS POSED. One drone alone, put into phase `diving` with travel on and fire
// off. The dive's path is the build's, laid out from where the drone stands toward
// the ship, as `specs/swarm.md` states; nothing here poses it. Fire is off so no
// bullet it spawns can reach the ship and end the scenario, and `startPosed` shuts
// the wave's own dive launcher so no second dive joins the reading.

import { afterEach, beforeEach, it } from "vitest";
import { droneSpeedScale, slotX, slotY } from "../../src/constants";
import {
  assertBetween,
  assertCloseTo,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  resetTo,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the ramp is read at, and the stage it is read against. */
const LATE_STAGE = 5;
const BASE_STAGE = 1;

/** What `specs/stages.md` says the late stage's dive covers, per the base stage's. */
const EXPECTED_RATIO =
  droneSpeedScale(LATE_STAGE) / droneSpeedScale(BASE_STAGE);

/**
 * How far the measurement runs, in seconds.
 *
 * The manifest's own window: "the distance in a second". A whole second of a dive
 * at `DIVE_SPEED` is 300 units at stage 1 and 372 at stage 5, which is a small
 * part of any swooping path down the field and back, so neither leg is measuring
 * the end of a dive.
 */
const MEASURED_FOR = 1;

/**
 * The least diving the reading may rest on, in seconds.
 *
 * A third of the window. A dive shorter than that leaves too few samples for a
 * rate to mean anything, and the check says so rather than dividing by it.
 */
const LEAST_DIVING = MEASURED_FOR / 3;

/**
 * How far the measured ratio may sit from the stated one, as a fraction.
 *
 * The manifest's own figure. The measurement itself is far tighter than this — the
 * frames are counted exactly and the chord-sum under-reads a curved path by the
 * same fraction on both legs, so the two errors very nearly cancel in the ratio —
 * so what the 10% band is really doing is deciding which wrong models this point
 * names. It separates the two large ones: a build that does not scale drones with
 * the stage at all reads 1.00, well below the band, and one that goes straight to
 * the 1.50 cap after the first stage reads 1.50, well above it.
 *
 * It cannot separate an off-by-one in the ramp, and nothing about a RATIO could:
 * a build multiplying by `1 + 0.06 * stage` rather than `1 + 0.06 * (stage - 1)`
 * reads 1.30 where the specification says 1.24 and 1.06 where it says 1.00, and
 * the two errors cancel to within a percent in the ratio between them. That model
 * is separated by the reading below instead — {@link SCALE_DIGITS} — which takes
 * the derived figure itself off the snapshot and admits nothing but the stated
 * formula. The band above stays where the manifest sets it, deciding what a
 * MEASURED dive may read.
 */
const TOLERANCE = 0.1;

/**
 * Decimal places the derived scale itself must agree to.
 *
 * Six, which is exact for this purpose: `droneSpeedScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. Reading it at the stage the ramp is measured at is what separates a
 * ramp that runs one step ahead of the stated one — `stages/scaling-drone-speed-cap`
 * reads the same field, but only where the formula has saturated and every ramp
 * reads the same 1.50.
 */
const SCALE_DIGITS = 6;

/** Where the dive is launched from: a top-row slot off the centre column. */
const FROM = { x: slotX(2), y: slotY(0) } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Units of path one posed dive covers per second of game time, at `stage`. */
async function diveRate(harness: Harness, stage: number): Promise<number> {
  resetTo(harness);
  startPosed(harness);
  harness.debug.setStage(stage);
  assertCloseTo(
    harness.snapshot().droneSpeedScale,
    droneSpeedScale(stage),
    SCALE_DIGITS,
    `the drone-speed scale the game derives at stage ${String(stage)}, ` +
      "min(1.50, 1 + 0.06 * (stage - 1)) (specs/stages.md), which the dive " +
      "measured below has to be flown at",
  );
  const id = poseDrone(harness, "shard", FROM.x, FROM.y, {
    phase: "diving",
    travel: true,
    fire: false,
  });

  let previous = harness.snapshot();
  let travelled = 0;
  let frames = 0;
  for (let frame = 0; frame < ticksFor(MEASURED_FOR); frame += 1) {
    await harness.advance(1);
    const now = harness.snapshot();
    const was = droneById(previous, id);
    const is = droneById(now, id);
    if (was === undefined || is === undefined || is.phase !== "diving") break;
    travelled += Math.hypot(is.x - was.x, is.y - was.y);
    frames += 1;
    previous = now;
  }

  assertGreaterThanOrEqual(
    seconds(frames),
    LEAST_DIVING,
    `seconds of diving to read a speed from at stage ${stage} (specs/swarm.md)`,
  );
  return travelled / seconds(frames);
}

it("moves a stage-five dive droneSpeedScale(5) times as fast as a stage-one dive", async () => {
  const base = await diveRate(h, BASE_STAGE);
  const late = await diveRate(h, LATE_STAGE);
  captureStill(h, "faster");

  assertBetween(
    late / base,
    EXPECTED_RATIO * (1 - TOLERANCE),
    EXPECTED_RATIO * (1 + TOLERANCE),
    `the ground a stage-${LATE_STAGE} dive covers per second over a stage-${BASE_STAGE} dive's, droneSpeedScale(${LATE_STAGE}) (specs/stages.md)`,
  );
});
