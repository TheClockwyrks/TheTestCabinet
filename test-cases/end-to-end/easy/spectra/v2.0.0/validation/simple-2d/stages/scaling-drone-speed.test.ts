// stages/scaling-drone-speed — a later stage's drones move faster.
//
// specs/stages.md, Scaling: `droneSpeedScale(stage)` is
// `min(1.50, 1 + 0.06 * (stage - 1))`, and it "multiplies the entrance and dive
// speeds in specs/swarm.md". specs/swarm.md fixes the stage-1 dive speed at
// `DIVE_SPEED` (`300`) units per second "along that path". So a dive covers
// `DIVE_SPEED` units of path in a second at stage 1 and
// `DIVE_SPEED * droneSpeedScale(5)` — 372 — at stage 5.
//
// WHY THE READING IS ABSOLUTE AND NOT A RATIO. Both stages are measured, and each
// is asserted against the figure specs/stages.md fixes for THAT stage. A ratio
// between the two would be blind to the one wrong model this point is best placed
// to name: a build running `1 + 0.06 * stage` rather than `1 + 0.06 * (stage - 1)`
// flies at 318 where the specification says 300 and at 390 where it says 372, and
// those two errors cancel to within a percent of each other in any ratio between
// them, whatever the band around it. Read against the specification's own figures
// they are 6% and 4.8% out, and separated.
//
// WHY THE EXPECTATION IS NOT THE BUILD'S OWN FORMULA. `droneSpeedScale` is read
// from this project's own `constants.ts`, which restates the ramp from
// specs/stages.md, rather than from the build's `src/constants.ts`. A build writes
// that file itself and may fly its dives off a formula of its own while the file
// still reads correctly, so the build's function is not evidence about the
// simulation; the restated one is the specification, and it is what the
// measurement below is held to.
//
// WHY STAGE FIVE. It is inside the ramp. The formula saturates at its 1.50 cap by
// stage 10, so a check posed at a later stage would be asserting the same figure
// `stages/scaling-drone-speed-cap` already asserts and the per-stage ramp would go
// ungraded. At stage 5 the wrong models each read differently: a build that does
// not scale reads 300, one that jumped straight to the cap reads 450, and one that
// scales by 0.06 per stage rather than per stage ABOVE THE FIRST reads 390.
//
// WHAT IS MEASURED, AND WHY IT IS A RATE RATHER THAN A DISTANCE. The dive's own
// PATH is the build's design — specs/swarm.md fixes only the speed along it — so
// the distance covered is summed frame by frame along whatever path the build
// flew, and divided by the game time it took. That makes the reading the speed the
// specification states rather than a demand on where the dive went, and it lets a
// dive that ends sooner than the window still be read.
//
// WHAT IS POSED. One drone alone, put into phase `diving` with travel on and fire
// off. The dive's path is the build's, laid out from where the drone stands toward
// the ship, as specs/swarm.md states; nothing here poses it. Fire is off so no
// bullet it spawns can reach the ship and end the scenario, and `startPosed` shuts
// the wave's own dive launcher so no second dive joins the reading.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_SPEED, droneSpeedScale, slotX, slotY } from "../constants";
import {
  assertBetween,
  assertCloseTo,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  findDrone,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the ramp is read at, and the stage it is read against. */
const LATE_STAGE = 5;
const BASE_STAGE = 1;

/** The units of path a dive covers in a second at `stage` (specs/stages.md). */
function expectedRate(stage: number): number {
  return DIVE_SPEED * droneSpeedScale(stage);
}

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
 * How far a measured rate may sit from the stated one, as a fraction.
 *
 * Three percent, and it is a measurement allowance rather than a licence on the
 * speed. The reading is a chord sum over frames of `1 / TICK_HZ` of a second: at
 * 372 units a second a frame carries the drone about three units, so a path would
 * have to turn some thirty degrees within one frame — a full circle inside a tenth
 * of a second — before the chords under-read the ground covered by even one
 * percent. No dive down a 1280x720 field bends anything like that, and the
 * reference builds read the stated figure to a part in 10^13.
 *
 * What the band is doing is deciding which wrong models this point names, and at
 * three percent it names all of them: no scaling reads 300 against a stage-5
 * expectation of 372, straight-to-the-cap reads 450, and the off-by-one ramp reads
 * 390 against 372 and 318 against a stage-1 expectation of 300 — 4.8% and 6% out,
 * each clear of the band's edge.
 */
const TOLERANCE = 0.03;

/**
 * Decimal places the derived scale itself must agree to.
 *
 * Six, which is exact for this purpose: `droneSpeedScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. This is the REPORTED figure, which is a requirement of its own and
 * not the evidence the measurement above rests on — that is why both are here.
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
  harness.debug.reset();
  startPosed(harness);
  harness.debug.setStage(stage);
  assertCloseTo(
    harness.snapshot().droneSpeedScale,
    droneSpeedScale(stage),
    SCALE_DIGITS,
    `the drone-speed scale the game derives at stage ${String(stage)}, ` +
      "min(1.50, 1 + 0.06 * (stage - 1)) (specs/stages.md)",
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
    const was = findDrone(previous, id);
    const is = findDrone(now, id);
    if (was === null || is === null || is.phase !== "diving") break;
    travelled += Math.hypot(is.x - was.x, is.y - was.y);
    frames += 1;
    previous = now;
  }

  assertGreaterThanOrEqual(
    seconds(frames),
    LEAST_DIVING,
    `seconds of diving to read a speed from at stage ${String(stage)} ` +
      "(specs/swarm.md)",
  );
  return travelled / seconds(frames);
}

/** Hold one leg's reading to `DIVE_SPEED * droneSpeedScale(stage)`. */
function assertRate(rate: number, stage: number): void {
  const expected = expectedRate(stage);
  assertBetween(
    rate,
    expected * (1 - TOLERANCE),
    expected * (1 + TOLERANCE),
    `the ground a stage-${String(stage)} dive covers per second ` +
      `(${rate.toFixed(1)} units), DIVE_SPEED * droneSpeedScale(` +
      `${String(stage)}) = ${expected.toFixed(1)} ` +
      "(specs/stages.md, specs/swarm.md)",
  );
}

it("flies a stage-five dive at DIVE_SPEED * droneSpeedScale(5)", async () => {
  const base = await diveRate(h, BASE_STAGE);
  const late = await diveRate(h, LATE_STAGE);
  captureStill(h, "faster");

  assertRate(base, BASE_STAGE);
  assertRate(late, LATE_STAGE);
});
