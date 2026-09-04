// field/sway-period — the sway's two extremes sit half a `SWAY_PERIOD` apart.
//
// specs/field.md, "The sway": "The block's offset is
// `swayOffset(t) = SWAY_AMP * sin(2 * PI * t / SWAY_PERIOD)`, with `SWAY_AMP`
// (`20`) and `SWAY_PERIOD` (`5`) seconds." A sine of period `SWAY_PERIOD` reaches
// its maximum and its minimum exactly `SWAY_PERIOD / 2` apart, so the seconds
// between one extreme and the next is the period, read without ever asking the
// build what its clock says.
//
// WHY THE SWEEP RUNS TWO PERIODS AND THE MINIMUM IS TAKEN AFTER THE MAXIMUM. A
// sweep exactly one period long would find a maximum and a minimum half a period
// apart for ALMOST ANY period — over any window, the highest and lowest samples of
// a slow enough sine sit roughly half the WINDOW apart, so the window would be
// measuring itself. Running two whole periods and then hunting the minimum in the
// period that FOLLOWS the maximum measures the wave instead: a build swaying twice
// as slowly answers a whole period, one swaying twice as fast answers a quarter,
// and neither can hide behind the length of the sweep.
//
// ONE DRONE, WITH TRAVEL ITS ONLY FACULTY, IN AN EMPTY POSED WAVE, exactly as
// `field/sway-amplitude` poses it. HOW FAR the swing reaches is that point; this one
// reads only WHEN it turns.

import { afterEach, beforeEach, it } from "vitest";
import { SWAY_PERIOD, slotX, slotY } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { droneOnRoster } from "./roster";

/**
 * How far the gap between the two extremes may sit from `SWAY_PERIOD / 2`, in
 * seconds. The item's own figure: within 10% of 2.5 s.
 */
const PERIOD_TOLERANCE = (SWAY_PERIOD / 2) * 0.1;

/**
 * How often the drone's `x` is read during the sweep, in frames.
 *
 * Not a tolerance: 0.05 s of game time is a fiftieth of the 2.5 s the gap is read
 * against, so the sampling grid costs at most a fiftieth of the tolerance above,
 * and the swing is an exactly evaluated sine rather than a noisy signal, so the
 * highest sample really is the one nearest the turn.
 */
const SAMPLE_EVERY = ticksFor(0.05);

/** Two whole periods, so the turn after a maximum is always inside the sweep. */
const SWEEP_FRAMES = ticksFor(2 * SWAY_PERIOD);

/**
 * How near the swing's furthest reading the still is taken, in logical units.
 *
 * Framing for the captured picture and nothing else: no verdict rests on it. Half a
 * unit puts the block within a fortieth of `SWAY_AMP` of its turn.
 */
const STILL_NEAR = 0.5;

/** The slot the drone rests in: the grid's leftmost column, middle row. */
const SLOT = { col: 0, row: 2 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("turns from its furthest right to its furthest left half a SWAY_PERIOD later", async () => {
  startPosed(harness);
  const id = poseDrone(harness, "shard", slotX(SLOT.col), slotY(SLOT.row), {
    phase: "formation",
    travel: true,
  });

  const swing: { t: number; x: number }[] = [];
  for (let frame = 0; frame < SWEEP_FRAMES; frame += SAMPLE_EVERY) {
    await harness.advance(SAMPLE_EVERY);
    swing.push({
      t: seconds(frame + SAMPLE_EVERY),
      x: droneOnRoster(harness.snapshot(), id, "across its sway sweep").x,
    });
  }

  // The furthest right of the first period, and the furthest left of the period
  // that follows it.
  const rightward = swing.filter((sample) => sample.t <= SWAY_PERIOD);
  const peak = rightward.reduce((best, sample) =>
    sample.x > best.x ? sample : best,
  );
  const trough = swing
    .filter((sample) => sample.t > peak.t && sample.t <= peak.t + SWAY_PERIOD)
    .reduce((best, sample) => (sample.x < best.x ? sample : best));

  // The still shows the block at one of those extremes rather than wherever the
  // sweep happened to stop.
  await harness.until(
    (snapshot) =>
      (droneById(snapshot, id)?.x ?? -Infinity) >= peak.x - STILL_NEAR,
    { maxFrames: ticksFor(SWAY_PERIOD) + 1, poll: 1 },
  );
  captureStill(harness, "period");

  assertLessThanOrEqual(
    Math.abs(trough.t - peak.t - SWAY_PERIOD / 2),
    PERIOD_TOLERANCE,
    `the seconds between the sway's furthest right (t = ${peak.t.toFixed(2)}, ` +
      `x = ${peak.x.toFixed(2)}) and the furthest left that followed it ` +
      `(t = ${trough.t.toFixed(2)}, x = ${trough.x.toFixed(2)}), against ` +
      `SWAY_PERIOD / 2 (${String(SWAY_PERIOD / 2)}) (specs/field.md)`,
  );
});
