// waves/speed-scales-per-wave — each wave's rocks drift four percent faster than
// the last's.
//
// `specs/progression.md`, Waves: "Each rock's speed is a Large's base drift speed
// (`specs/rocks.md`) multiplied by `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N -
// 1))` with `WAVE_SPEED_STEP` (`0.04`) and `WAVE_SPEED_CAP` (`0.4`), so wave 1's
// rocks take the plain range, wave 6's are `20` percent faster". `specs/rocks.md`
// gives a Large's base drift speed as a value "drawn uniformly" from
// `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (`60` to `110`).
//
// WHAT IS BEING MEASURED, AND WHY IT TAKES MORE THAN ONE WAVE. The multiplier does
// not fix a rock's speed; it scales the RANGE a rock's speed is drawn from. Wave
// 6's band is `[72, 132]` where wave 1's is `[60, 110]`, and the two overlap over
// most of their length — a single rock at 100 units per second is an ordinary
// member of either. So no reading of one rock, and no reading of one wave's nine,
// can tell the two apart. What can is the BAND itself, and that is read here off
// two hundred and sixteen rocks: twenty-four games, each posed at wave 5 and shot
// clear, each answering with the nine rocks of wave 6.
//
// TWO ASSERTIONS, AND THEY FAIL DIFFERENT BUILDS.
//
//   - CONTAINMENT. Every one of the two hundred and sixteen speeds lies inside the
//     scaled band, within three percent. This is the specification read literally,
//     one rock at a time, and it is one-sided-safe: a conformant build satisfies it
//     on every rock, however the draws fall. It is what kills a build that does not
//     scale at all — such a build draws under seventy units per second about one
//     rock in five, and over two hundred rocks it will do so.
//   - THE MEAN. A uniform draw's expectation is the midpoint of its range, so two
//     hundred and sixteen samples of `[72, 132]` average `102` with a standard
//     error near one and a half. The band below is a sampling band, not a
//     per-rock one, and it is what separates a build whose step is in the right
//     direction but the wrong size from one that has the figure right.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. No scaling at all averages 85;
// scaling by the wave number rather than by the step averages far above the band
// and breaks containment on the first rock; applying the step from wave 0 rather
// than wave 1 averages 106; running the step backwards averages 68. A failure names
// the mean it found and the rock that broke containment, so which one the build
// implemented is readable off the message.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  WAVE_SPEED_STEP,
} from "../../src/constants";
import { assertBetween } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  describeSample,
  fastest,
  gatherSpawnSpeeds,
  meanOf,
  slowest,
  waveSpeedScale,
  type SpeedSample,
} from "./scenario";

/** The wave the run is posed at, and the wave clearing it announces. */
const POSED_WAVE = 5;
const MEASURED_WAVE = POSED_WAVE + 1;

/** The multiplier `specs/progression.md` gives wave 6: `1 + 0.04 x 5` = `1.20`. */
const SCALE = waveSpeedScale(MEASURED_WAVE);

/** The band wave 6's speeds are drawn from, straight off the two specs' figures. */
const BAND_LOW = ROCK_SPEED_MIN.large * SCALE;
const BAND_HIGH = ROCK_SPEED_MAX.large * SCALE;

/**
 * The twenty-four seeds the band is sampled on: `9` rocks each, `216` in all.
 *
 * Enough that the sample's mean is worth reading — the standard error of the mean
 * of `216` draws from a `60 x 1.2`-wide uniform is about one and a half units per
 * second, so the six percent below is more than four of them — and enough that a
 * build drawing from the UNSCALED band all but certainly puts a rock under the
 * containment floor, which it does about once in five.
 */
const SEEDS = [
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  50, 61, 62, 63, 64,
];

/**
 * How far outside the scaled band one rock's speed may read: three percent, the
 * review item's own figure, plus a unit for the well.
 *
 * The three percent is the tolerance the item promises and it is checked against
 * each end of the band separately. The extra unit is the environment rather than
 * the rule: `specs/gravity.md`'s well is working on a rock from the tick it exists,
 * and at `WAVE_MIN_STAR_DIST` it adds `0.94` units per second in a tick — `MU / d^2`
 * over `TICK_HZ` — which is what a reading taken on the tick of arrival can carry,
 * and which the unit below covers with a little over.
 */
const BAND_TOLERANCE = 0.03;
const WELL_SLACK = 1;

/** The ends the containment assertion holds every sample between. */
const FLOOR = BAND_LOW * (1 - BAND_TOLERANCE) - WELL_SLACK;
const CEILING = BAND_HIGH * (1 + BAND_TOLERANCE) + WELL_SLACK;

/** What a uniform draw over the scaled band averages: its midpoint. */
const EXPECTED_MEAN = (BAND_LOW + BAND_HIGH) / 2;

/**
 * How far the sample's mean may fall from that midpoint: six percent.
 *
 * A SAMPLING BAND, NOT A PER-ROCK ONE, and it is set from the sampling error
 * rather than from any build. The standard error above is about `1.4` units per
 * second against a mean of `102`, so six percent is more than four standard errors
 * — a conformant build strays outside it about once in ten thousand runs. It stays
 * decisive: a build that does not scale averages `85`, sixteen percent low, and one
 * that scales by twice the stated step averages `119`, sixteen percent high.
 */
const MEAN_TOLERANCE = 0.06;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws wave 6's speeds from a band 20 percent above wave 1's", async () => {
  const samples: SpeedSample[] = await gatherSpawnSpeeds(h, POSED_WAVE, SEEDS);
  captureStill(h, "wave");

  const low = slowest(samples);
  const high = fastest(samples);
  const context =
    `${samples.length} rocks over ${SEEDS.length} wave-${MEASURED_WAVE} ` +
    `spawns, whose base drift speeds specs/progression.md draws from ` +
    `[${ROCK_SPEED_MIN.large}, ${ROCK_SPEED_MAX.large}] scaled by ` +
    `1 + WAVE_SPEED_STEP x ${MEASURED_WAVE - 1} (${SCALE.toFixed(2)}), so ` +
    `[${BAND_LOW.toFixed(1)}, ${BAND_HIGH.toFixed(1)}]`;

  assertBetween(
    low.speed,
    FLOOR,
    CEILING,
    `the slowest of ${context} — ${describeSample(low)}`,
  );
  assertBetween(
    high.speed,
    FLOOR,
    CEILING,
    `the fastest of ${context} — ${describeSample(high)}`,
  );
  assertBetween(
    meanOf(samples.map((sample) => sample.speed)),
    EXPECTED_MEAN * (1 - MEAN_TOLERANCE),
    EXPECTED_MEAN * (1 + MEAN_TOLERANCE),
    `the mean of ${context}, whose midpoint is ${EXPECTED_MEAN.toFixed(1)} ` +
      `(WAVE_SPEED_STEP is ${WAVE_SPEED_STEP})`,
  );
});
