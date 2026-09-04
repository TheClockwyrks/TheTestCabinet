// Spectra — screens/hud-lives: the HUD reports the lives remaining.
//
// THE RULE. `specs/ui.md` gives the lives readout its content — "The lives
// remaining, as a row of icons or as a count. It changes as the lives change." —
// and `specs/field.md` puts it in the BOTTOM HUD strip, `y` in
// `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`). The specification deliberately
// leaves the form open, so this point reads the one thing it fixes: that the
// strip's drawing CHANGES when the lives change.
//
// WHAT IS READ, AND WHY IT IS THE WHOLE STRIP. `specs/field.md` says in as many
// words that "how each is composed and placed within its strip is yours", so a
// check that read a fixed box would be asserting a layout the specification leaves
// to the build. The strip itself is fixed, so the strip is what is read: every
// sample of it at `START_LIVES` lives, and every sample of it at `FEWER_LIVES`,
// and how many of them moved.
//
// THE DISTINGUISHING POSE. `START_LIVES` (`3`) down to `1` — two lives apart, so a
// row of icons loses two of them and a count changes its one digit. Both readings
// are taken on the same posed live wave, with nothing else touched, so the only
// thing that can have moved the strip is the number of lives.
//
// THE CONTROL. A build is free to animate what it draws, and a strip that shimmers
// on its own would let "something moved" pass a build whose readout never followed
// the lives at all. So the strip's own frame-to-frame drift is measured first,
// with nothing posed between the two readings, at the same lattice and the same
// per-sample distance, and the change the lives cause has to beat it.
//
// THE LIVES ARE POSED, NOT LOST. `setLives` is what `specs/instrumentation.md`
// provides; what COSTS a life is the `progression` group's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import { BOTTOM_STRIP, changedSamples, driftOverOneFrame } from "./reading";

/** The lives the two readings are taken at. */
const FEWER_LIVES = 1;

/**
 * How far a sample must move to count as repainted, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/ui.md` states the rule and leaves the palette to
 * the build: `40` is about a tenth of the space, which is the least a player reads
 * as a change at a glance, and far above the nothing that separates two readings
 * of one unchanged pixel.
 */
const REPAINT_MIN = 40;

/**
 * How many samples of the strip must be repainted.
 *
 * The lattice below is one sample every two logical units in each direction, so
 * `16` samples is about `64` square units of the strip — an eight-by-eight mark,
 * which is smaller than one digit of type legible at the stage's `1280 x 720`
 * (`specs/ui.md`) and smaller than one life icon in a `64`-unit-tall strip. It is
 * a floor under anti-aliasing noise on a single glyph edge rather than a demand on
 * how a build draws the readout.
 */
const REPAINT_MIN_SAMPLES = 16;

/** One sample every two logical units: `20480` over the whole strip. */
const READ_STEP = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("repaints the bottom strip when the lives remaining change", async () => {
  await startPosed(h);
  await h.debug.setLives(START_LIVES);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).lives,
    START_LIVES,
    "the run is posed at START_LIVES lives",
  );

  // What the strip does on its own across one frame, with nothing posed.
  const drift = await driftOverOneFrame(
    h,
    BOTTOM_STRIP,
    READ_STEP,
    REPAINT_MIN,
  );
  const atFull = drift.reading;

  await h.debug.setLives(FEWER_LIVES);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).lives,
    FEWER_LIVES,
    "the run is posed at the second lives count",
  );
  const atFewer = await readRegion(h, BOTTOM_STRIP, READ_STEP);
  await captureStill(h, "lives");

  assertGreaterThan(
    changedSamples(atFull, atFewer, REPAINT_MIN),
    Math.max(drift.count, REPAINT_MIN_SAMPLES),
    `samples of the bottom HUD strip repainted when the lives went from ` +
      `${START_LIVES} to ${FEWER_LIVES} — the lives readout "changes as the ` +
      `lives change" (specs/ui.md) and sits in that strip (specs/field.md); ` +
      `the strip moved on its own across one frame in ${drift.count} samples`,
  );
});
