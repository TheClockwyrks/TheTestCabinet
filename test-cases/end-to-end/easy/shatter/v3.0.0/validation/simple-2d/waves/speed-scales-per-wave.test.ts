// waves/speed-scales-per-wave — each wave's rocks drift four percent faster than
// the one before.
//
// THE RULE. `specs/progression.md`, "Waves": "Each rock's speed is a Large's base
// drift speed (`specs/rocks.md`) multiplied by `1 + min(WAVE_SPEED_CAP,
// WAVE_SPEED_STEP * (N - 1))` with `WAVE_SPEED_STEP` (`0.04`) and
// `WAVE_SPEED_CAP` (`0.4`), so wave 1's rocks take the plain range, wave 6's are
// `20` percent faster".
//
// WHAT IS MEASURED. The ratio of wave 6's base drift speeds to wave 1's, against
// `1 + WAVE_SPEED_STEP * 5` = `1.20`. THE RATIO, so the base range itself falls
// out of the comparison entirely: `specs/rocks.md` gives a Large `60` to `110`,
// and a build whose range is wrong but whose per-wave scaling is right passes here
// and loses `rocks/drift-speed-large`, which is the item for the range. It is also
// the reading the review item states — "scaled by 1 + WAVE_SPEED_STEP x 5 AGAINST
// WAVE 1'S" — rather than a band read off one wave in isolation.
//
// WHY A STATISTIC AND NOT A ROCK. A base drift speed is DRAWN — "drawn uniformly
// from its size's range" (`specs/rocks.md`) — so one rock of wave 6 says nothing
// at all about the factor: a slow draw at `1.20` and a fast draw at `1.00` produce
// the same number. What is compared is the MIDRANGE of each wave's sample,
// `(min + max) / 2`, which for a uniform draw is the minimum-variance unbiased
// estimator of the distribution's midpoint and therefore of the factor the range
// was multiplied by (`./scenario.ts`, {@link midrange}).
//
// AND WHY THE MIDRANGE RATHER THAN THE MEAN. The mean of a `60`-to-`110` draw
// wanders by about `1.4` percent over a hundred rocks, which is half the tolerance
// this item is allowed. The midrange's spread falls like `1 / n` rather than like
// `1 / sqrt(n)`: over the same hundred-odd rocks it wanders by about a third of
// one percent, so the tolerance below is room for a build's arithmetic rather than
// room for the check's own noise.
//
// THE SAMPLE. A hundred and twenty rocks on each side, gathered by flying wave
// after wave until that many have arrived — a ROCK count rather than a wave count,
// so both samples carry the same spread whatever a build's waves happen to hold.
// Each flight is a fresh `reset` to its own seed, so each is an independent draw
// of the whole wave (`specs/simulation.md`, "Seeded randomness"), and both waves
// are reached the SAME way: posed at `N - 1` with the wave loop running, and
// cleared by shooting the field's last rock down.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that applies no
// per-wave scaling at all reads `1.00`, twenty percent out and nearly seven times
// the bound. A build that halves or doubles the step reads `1.10` or `1.40`. A
// build that applies the cap from the start reads `1.40`.
//
// TWO WRONG MODELS THIS ITEM DOES NOT SEPARATE, AND WHERE THEY ARE CAUGHT. A build
// that scales from `N` rather than from `N - 1` reads `1.24`, and one that
// COMPOUNDS the step rather than adding it reads `1.04 ^ 5` = `1.217`: both sit
// just outside and just inside a three percent bound around `1.20`, which is too
// fine a distinction for a check whose input is a hundred and twenty drawn
// numbers. Neither escapes the group. `speed-is-capped` compares wave 20 against
// wave 1, and an off-by-one build reads `1.40 / 1.04` = `1.35` there — five bounds
// out — because the same defect moves its BASELINE as well. That is why the two
// speed items pose waves on opposite sides of the cap rather than one item posing
// both.
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
// makes the base drift speed "the speed it enters the field with" and every tick
// afterwards is a tick `specs/gravity.md`'s well has been bending it. At most one
// tick of the well is inside a reading — where a spawn sits among a tick's six
// steps is not something `specs/simulation.md` fixes — and at the closest a wave
// may spawn to the star that is under one unit per second (`./scenario.ts`,
// {@link SPAWN_WELL_PER_TICK}), against a smallest legal base speed of `60`.
//
// WHAT THIS ITEM DOES NOT DECIDE. The CAP, which is `speed-is-capped`'s point: at
// wave 6 the cap is nowhere near, so a build that never caps at all passes here
// and fails there.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_SPEED_CAP, WAVE_SPEED_STEP } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  SPAWN_WELL_PER_TICK,
  midrange,
  sampleWaveSpeeds,
  waveSpeedScale,
} from "./scenario";

/** The two waves compared: the plain range, and five steps above it. */
const BASELINE_WAVE = 1;
const SCALED_WAVE = 6;

/**
 * How many rocks each of the two samples gathers, and the ceiling on the waves
 * flown for them.
 *
 * A hundred and twenty rocks a side. The midrange of a `60`-to-`110` uniform draw
 * over that many samples wanders by about a third of one percent, which is a ninth
 * of the tolerance this item allows — so the bound below is room for a build's
 * arithmetic rather than room for the check's own noise. A conformant build
 * reaches it in thirty waves of wave 1 and fourteen of wave 6; the ceiling is what
 * stops a build whose waves are nearly empty from spinning, and it is a bound on
 * the scenario rather than a threshold on the build.
 */
const SAMPLE_ROCKS = 120;
const MAX_RUNS = 130;

/** The seed each sample's first run is reset to; each later run takes the next. */
const BASELINE_FIRST_SEED = 31;
const SCALED_FIRST_SEED = 1031;

/**
 * How far the measured ratio may fall from what the specification asks for.
 *
 * 3 percent, which is the figure the review item states, and inside it sit exactly
 * two things: the midrange's own spread over samples this size, which is about a
 * third of one percent on each of the two waves, and the at-most one tick of the
 * well that is in every reading, worth under `0.94` units per second at
 * `WAVE_MIN_STAR_DIST` against a `60`-to-`110` range. Together they are under a
 * fifth of the bound; the rest is room for a build's own arithmetic.
 */
const RATIO_TOLERANCE = 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drifts wave 6's rocks WAVE_SPEED_STEP per wave faster than wave 1's", async () => {
  const baseline = await sampleWaveSpeeds(h, BASELINE_WAVE, {
    rocks: SAMPLE_ROCKS,
    maxRuns: MAX_RUNS,
    firstSeed: BASELINE_FIRST_SEED,
  });
  const scaled = await sampleWaveSpeeds(h, SCALED_WAVE, {
    rocks: SAMPLE_ROCKS,
    maxRuns: MAX_RUNS,
    firstSeed: SCALED_FIRST_SEED,
  });
  // The faster rocks of a later wave, as the last flight of wave 6 left them.
  captureStill(h, "wave");

  // What `specs/progression.md` says the ratio is, for the two waves the build
  // reported spawning: `1 + WAVE_SPEED_STEP * 5` = `1.20` for a build whose wave
  // number advances by one, as waves/wave-number-increments requires separately.
  const wanted = waveSpeedScale(scaled.wave) / waveSpeedScale(baseline.wave);

  const slow = midrange(baseline.speeds);
  const fast = midrange(scaled.speeds);

  // A midrange of zero would make the ratio meaningless, and a build whose waves
  // do not drift at all is what produces one.
  assertGreaterThan(
    slow,
    0,
    `wave ${String(baseline.wave)}'s rocks drifting at all, which is what the ` +
      `ratio below is taken against — a wave sets its rocks drifting in a ` +
      `random direction at a Large's base drift speed (specs/progression.md, ` +
      `specs/rocks.md)`,
  );

  const ratio = fast / slow;

  assertLessThanOrEqual(
    Math.abs(ratio - wanted),
    RATIO_TOLERANCE,
    `wave ${String(scaled.wave)}'s base drift speeds ` +
      `${wanted.toFixed(2)} times wave ${String(baseline.wave)}'s, within ` +
      `${String(RATIO_TOLERANCE)} — a wave's speeds are the Large base range ` +
      `multiplied by 1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1)), with ` +
      `WAVE_SPEED_STEP ${String(WAVE_SPEED_STEP)} and WAVE_SPEED_CAP ` +
      `${String(WAVE_SPEED_CAP)} (specs/progression.md); measured as the ratio ` +
      `of the two samples' midranges, ${fast.toFixed(2)} over ` +
      `${slow.toFixed(2)}, from ${String(scaled.speeds.length)} and ` +
      `${String(baseline.speeds.length)} rocks read on the tick each wave ` +
      `arrived, where at most ${SPAWN_WELL_PER_TICK.toFixed(2)} units per ` +
      `second of the well is in a reading; a ratio of 1.00 is a build that ` +
      `never scales, and a build that scales from N rather than from N - 1 ` +
      `sits just outside this bound and is decided squarely by ` +
      `waves/speed-is-capped`,
  );
});
