// waves/speed-is-capped — the per-wave speed scaling stops at forty percent.
//
// `specs/progression.md`, Waves: each rock's speed is a Large's base drift speed
// multiplied by `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))`, with
// `WAVE_SPEED_CAP` (`0.4`), "so ... every wave from 11 onward is `40` percent
// faster". `specs/rocks.md` gives a Large's base drift speed as a value "drawn
// uniformly" from `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (`60` to `110`).
//
// THE `min` IS THE WHOLE ITEM. `speed-scales-per-wave` reads the step where it is
// still climbing; this reads it where it has stopped. Wave 20 is deep past the
// eleventh, so a build that took the step and forgot the cap is asking for `1 +
// 0.04 x 19` — `1.76`, drawing speeds up to `194` where the specification tops out
// at `154`. That is not a near miss: it breaks containment on about two rocks in
// five and lifts the mean by a quarter.
//
// WHY THE BAND AND NOT A FIGURE. The multiplier scales the RANGE a speed is drawn
// from rather than fixing a speed, so no reading of one rock decides anything. What
// decides it is the band, read off two hundred and thirty rocks: ten games, each
// posed at wave 19 and shot clear, each answering with the twenty-three rocks of
// wave 20. The two assertions are the same pair `speed-scales-per-wave` makes and
// they fail different builds — containment is the specification read literally, one
// rock at a time, and the mean separates a build whose cap is at the wrong height
// from one that has the figure right.
//
// AND WAVE 20 RATHER THAN WAVE 11. The cap first binds at wave 11, where it and the
// uncapped step give the same number — `1 + 0.04 x 10` is exactly `1.4` — so a
// build with no cap at all reads as conformant there. Wave 20 is the review item's
// figure and it is where the two models are furthest apart while the wave is still
// one a player reaches.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  WAVE_SPEED_CAP,
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
const POSED_WAVE = 19;
const MEASURED_WAVE = POSED_WAVE + 1;

/** The multiplier `specs/progression.md` gives wave 20: `1 + WAVE_SPEED_CAP`. */
const SCALE = waveSpeedScale(MEASURED_WAVE);

/** The band wave 20's speeds are drawn from, straight off the two specs' figures. */
const BAND_LOW = ROCK_SPEED_MIN.large * SCALE;
const BAND_HIGH = ROCK_SPEED_MAX.large * SCALE;

/**
 * The ten seeds the band is sampled on: `23` rocks each, `230` in all.
 *
 * Enough that the sample's mean is worth reading — the standard error of the mean
 * of `230` draws from a `60 x 1.4`-wide uniform is about one and a half units per
 * second, so the six percent below is more than four of them — and enough that a
 * build with no cap all but certainly puts a rock over the containment ceiling,
 * which it does about twice in five.
 */
const SEEDS = [51, 52, 53, 54, 55, 56, 57, 58, 59, 60];

/**
 * How far outside the scaled band one rock's speed may read: three percent, the
 * review item's own figure, plus a unit for the well.
 *
 * The three percent is the tolerance the item promises, checked against each end of
 * the band separately. The extra unit is the environment rather than the rule:
 * `specs/gravity.md`'s well is working on a rock from the tick it exists, and at
 * `WAVE_MIN_STAR_DIST` it adds `0.94` units per second in a tick — `MU / d^2` over
 * `TICK_HZ` — which is what a reading taken on the tick of arrival can carry, and
 * which the unit below covers with a little over.
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
 * A SAMPLING BAND, NOT A PER-ROCK ONE, set from the sampling error rather than from
 * any build: the standard error above is under two units per second against a mean
 * of `119`, so six percent is close to four standard errors. It stays decisive — a
 * build that never caps averages `150` at this wave, a quarter above the band.
 */
const MEAN_TOLERANCE = 0.06;

/** What an uncapped build would ask for at this wave, named in the messages. */
const UNCAPPED_SCALE = 1 + WAVE_SPEED_STEP * (MEASURED_WAVE - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws wave 20's speeds from the capped band, not the climbing one", async () => {
  const samples: SpeedSample[] = await gatherSpawnSpeeds(h, POSED_WAVE, SEEDS);
  captureStill(h, "wave");

  const low = slowest(samples);
  const high = fastest(samples);
  const context =
    `${samples.length} rocks over ${SEEDS.length} wave-${MEASURED_WAVE} ` +
    `spawns, whose base drift speeds specs/progression.md draws from ` +
    `[${ROCK_SPEED_MIN.large}, ${ROCK_SPEED_MAX.large}] scaled by ` +
    `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP x ${MEASURED_WAVE - 1}) = ` +
    `1 + ${WAVE_SPEED_CAP} (${SCALE.toFixed(2)}), so ` +
    `[${BAND_LOW.toFixed(1)}, ${BAND_HIGH.toFixed(1)}]; an uncapped build would ` +
    `scale by ${UNCAPPED_SCALE.toFixed(2)}`;

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
    `the mean of ${context}, whose midpoint is ${EXPECTED_MEAN.toFixed(1)}`,
  );
});
