// waves/speed-is-capped — the per-wave speed scaling stops at forty percent.
//
// THE RULE. `specs/progression.md`, "Waves": each rock's speed is a Large's base
// drift speed "multiplied by `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))`
// with `WAVE_SPEED_STEP` (`0.04`) and `WAVE_SPEED_CAP` (`0.4`) … and every wave
// from 11 onward is `40` percent faster".
//
// WHAT IS MEASURED. The ratio of wave 20's base drift speeds to wave 1's, against
// `1 + WAVE_SPEED_CAP` = `1.40`. THE CAP, which is the whole of what separates
// this item from `speed-scales-per-wave`: that item reads a wave below the cap,
// where the step is all there is; this one reads a wave far above it, where the
// `min` is what decides the answer.
//
// AND THE RATIO RATHER THAN A BAND. `1.40` is a factor the base range is
// multiplied BY, so what proves it is the two waves read against each other. A
// build whose base range is wrong but whose scaling is right passes here and loses
// `rocks/drift-speed-large`, which is the item for the range — one point per
// requirement rather than three per defect. It is also what makes the reading
// decisive at all: the cap saturates, so wave 20's speeds are the SAME whether a
// build takes the step from `N - 1` or from `N`, and only the baseline — where
// `1.00` and `1.04` are still far apart — tells the two builds apart.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no cap at
// all reads `1 + 0.04 * 19` = `1.76`, twenty-six percent out and nine times the
// bound. A build that caps at the wrong figure — the step itself, `1.04`, or a
// doubled cap, `1.80` — reads those. A build that takes the step from the wave
// number rather than from one less reads `1.40 / 1.04` = `1.35`, five bounds out,
// because the defect lifts its baseline while the cap holds its wave 20 still; it
// is this item, and not `speed-scales-per-wave`, that decides that build. A build
// that caps the SPEED rather than the factor, at some absolute figure, flattens
// the whole range rather than scaling it and reads a midrange the ratio cannot
// land on. A build with no per-wave scaling at all reads `1.00`, which fails here
// and fails `speed-scales-per-wave` too — the two items together say whether a
// build has the step, the cap, both or neither.
//
// WHY WAVE 20 AND NOT WAVE 11. Wave 11 is the first wave the cap bites on, so a
// build that is out by one wave — capping from 12, say — still reads `1.40` there
// and would pass. At wave 20 an uncapped build is nine bounds away and a build
// that caps a wave late is still capped, so what the reading is about is the cap
// and not the boundary it starts at.
//
// THE STATISTIC, THE SAMPLE AND THE TOLERANCE are `speed-scales-per-wave`'s, for
// the reasons its header gives: a base drift speed is DRAWN uniformly, so what is
// compared is each wave's MIDRANGE — the minimum-variance unbiased estimator of a
// uniform's midpoint — over a hundred and twenty rocks a side, gathered by flying
// wave after wave until that many have arrived rather than by flying a fixed
// number of waves. Both waves are reached the same way, by posing the wave at
// `N - 1` with the wave loop running and shooting the field's last rock down.
//
// THE FACTOR IS READ AGAINST THE WAVE THE BUILD SAYS IT SPAWNED, not against the
// one this check posed. `specs/progression.md` states two separate rules — the
// wave number advances by one on a clear, and wave `N`'s speeds carry `N`'s factor
// — and `wave-number-increments` is the item for the first. A build that advances
// by two is wrong about that rule and can be exactly right about this one; read
// against the posed wave it would lose this point as well, for a defect it has
// already been charged for.
//
// THE READING IS TAKEN ON THE TICK EACH WAVE ARRIVES, because `specs/rocks.md`
// makes the base drift speed "the speed it enters the field with".
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_SPEED_CAP, WAVE_SPEED_STEP } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  SPAWN_WELL_PER_TICK,
  midrange,
  sampleWaveSpeeds,
  waveSpeedScale,
} from "./scenario";

/** The two waves compared: the plain range, and one far above the cap. */
const BASELINE_WAVE = 1;
const CAPPED_WAVE = 20;

/**
 * How many rocks each of the two samples gathers, and the ceiling on the waves
 * flown for them.
 *
 * A hundred and twenty rocks a side. The midrange of a `60`-to-`110` uniform draw
 * over that many samples wanders by about a third of one percent, which is a ninth
 * of the tolerance this item allows — so the bound below is room for a build's
 * arithmetic rather than room for the check's own noise. A conformant build
 * reaches it in thirty waves of wave 1 and six of wave 20; the ceiling is what
 * stops a build whose waves are nearly empty from spinning, and it is a bound on
 * the scenario rather than a threshold on the build.
 */
const SAMPLE_ROCKS = 120;
const MAX_RUNS = 130;

/** The seed each sample's first run is reset to; each later run takes the next. */
const BASELINE_FIRST_SEED = 51;
const CAPPED_FIRST_SEED = 1051;

/**
 * How far the measured ratio may fall from what the specification asks for.
 *
 * 3 percent, which is the figure the review item states, on the derivation
 * `speed-scales-per-wave` gives: the midrange's own spread over samples this size
 * is about a third of one percent on each wave, and the at-most one tick of the
 * well inside a reading is worth under `0.94` units per second at
 * `WAVE_MIN_STAR_DIST`.
 */
const RATIO_TOLERANCE = 0.03;

/** What a build that never caps would read, for the failure message. */
const UNCAPPED = 1 + WAVE_SPEED_STEP * (CAPPED_WAVE - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops the per-wave scaling at 1 + WAVE_SPEED_CAP", async () => {
  const baseline = await sampleWaveSpeeds(h, BASELINE_WAVE, {
    rocks: SAMPLE_ROCKS,
    maxRuns: MAX_RUNS,
    firstSeed: BASELINE_FIRST_SEED,
  });
  const capped = await sampleWaveSpeeds(h, CAPPED_WAVE, {
    rocks: SAMPLE_ROCKS,
    maxRuns: MAX_RUNS,
    firstSeed: CAPPED_FIRST_SEED,
  });
  // Wave 20's rocks, at the capped drift speed, as the last flight left them.
  // The sample above runs undrawn, so one tick is drawn for the picture — after
  // every speed the verdict rests on has been read.
  await h.advance(1);
  captureStill(h, "wave");

  // What `specs/progression.md` says the ratio is, for the two waves the build
  // reported spawning: `1 + WAVE_SPEED_CAP` = `1.40` for a build whose wave
  // number advances by one, as waves/wave-number-increments requires separately.
  const wanted = waveSpeedScale(capped.wave) / waveSpeedScale(baseline.wave);

  const slow = midrange(baseline.speeds);
  const fast = midrange(capped.speeds);

  assertGreaterThan(
    slow,
    0,
    `wave ${String(baseline.wave)}'s rocks drifting at all, which is what the ` +
      `ratio below is taken against (specs/progression.md, specs/rocks.md)`,
  );

  const ratio = fast / slow;

  assertLessThanOrEqual(
    Math.abs(ratio - wanted),
    RATIO_TOLERANCE,
    `wave ${String(capped.wave)}'s base drift speeds ` +
      `${wanted.toFixed(2)} times wave ${String(baseline.wave)}'s — the capped ` +
      `factor 1 + WAVE_SPEED_CAP over the baseline's — within ` +
      `${String(RATIO_TOLERANCE)}: the per-wave scaling is ` +
      `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1)), so every wave from ` +
      `11 onward drifts ${String(WAVE_SPEED_CAP * 100)} percent faster and no ` +
      `faster (specs/progression.md); measured as the ratio of the two ` +
      `samples' midranges, ${fast.toFixed(2)} over ${slow.toFixed(2)}, from ` +
      `${String(capped.speeds.length)} and ` +
      `${String(baseline.speeds.length)} rocks read on the tick each wave ` +
      `arrived, where at most ${SPAWN_WELL_PER_TICK.toFixed(2)} units per ` +
      `second of the well is in a reading; ${UNCAPPED.toFixed(2)} is a build ` +
      `that never caps at all, and 1.35 is one that takes the step from N ` +
      `rather than from N - 1`,
  );
});
