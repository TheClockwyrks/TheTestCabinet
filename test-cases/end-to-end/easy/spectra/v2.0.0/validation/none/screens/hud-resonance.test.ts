// Spectra — screens/hud-resonance: the meter's filled extent grows with it.
//
// THE RULE. `specs/ui.md` gives the resonance readout its content: "The meter, as
// a bar whose filled extent grows with it from empty at `0` to full at
// `RESONANCE_MAX`." `specs/field.md` puts it in the BOTTOM HUD strip, `y` in
// `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`), and says how it is composed and
// placed within that strip is the build's.
//
// WHAT IS MEASURED. The meter is read at the three values the review item names —
// `0`, half, and `RESONANCE_MAX` — and what is compared is HOW MUCH OF THE STRIP
// EACH READING PUT DOWN THAT THE EMPTY ONE DID NOT. That is the filled extent
// stated as pixels rather than as a layout: a bar filled from the left, from the
// right, in segments, or as an arc all paint more of the strip at half than at
// empty and more again at full, and none of them is assumed. Nothing is asserted
// about where the bar is, how long it is, or which way it grows, because
// `specs/ui.md` fixes none of that.
//
// GROWS, NOT MERELY DIFFERS. Half must paint more of the strip than empty, and
// full more than half. A build whose meter jumps between two states, or draws the
// same mark whatever the reading, fails on the pair rather than on a single
// threshold — which is what "grows with it" means and what a two-value check could
// not decide.
//
// THE CONTROL. A build is free to animate what it draws, so the strip's own
// frame-to-frame drift is measured first, with nothing posed between the two
// readings, at the same lattice and the same per-sample distance, and the fill at
// half has to beat it.
//
// THE METER IS POSED, NOT FILLED. `setResonance` is what
// `specs/instrumentation.md` provides; what FILLS the meter is the `resonance`
// group's.
//
// WHAT IS NOT ASSERTED. That a FULL meter is drawn distinctly from one a point
// below full — the "a discharge is ready" reading — which is
// `screens/hud-resonance-ready`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import {
  BOTTOM_STRIP,
  PAINT_MIN,
  changedSamples,
  driftOverOneFrame,
} from "./reading";

/** The three readings the review item names. */
const EMPTY = 0;
const HALF = RESONANCE_MAX / 2;

/** One sample every two logical units: `20480` over the whole strip. */
const READ_STEP = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints more of the strip at half the meter than at none, and more again at full", async () => {
  await startPosed(h);
  await h.debug.setResonance(EMPTY);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).resonance,
    EMPTY,
    "the meter is posed empty (specs/instrumentation.md)",
  );

  const drift = await driftOverOneFrame(h, BOTTOM_STRIP, READ_STEP, PAINT_MIN);
  const atEmpty = drift.reading;

  await h.debug.setResonance(HALF);
  await h.advance(1);
  assertEqual((await h.snapshot()).resonance, HALF, "the meter is posed half");
  const atHalf = await readRegion(h, BOTTOM_STRIP, READ_STEP);

  await h.debug.setResonance(RESONANCE_MAX);
  await h.advance(1);
  const full = await h.snapshot();
  assertEqual(full.resonance, RESONANCE_MAX, "the meter is posed full");
  assertEqual(
    full.dischargeReady,
    true,
    "dischargeReady follows the meter (specs/instrumentation.md)",
  );
  const atFull = await readRegion(h, BOTTOM_STRIP, READ_STEP);
  await captureStill(h, "meter");

  const filledAtHalf = changedSamples(atEmpty, atHalf, PAINT_MIN);
  const filledAtFull = changedSamples(atEmpty, atFull, PAINT_MIN);

  assertGreaterThan(
    filledAtHalf,
    drift.count,
    `samples of the bottom HUD strip the meter painted at ${HALF} that it did ` +
      `not paint at ${EMPTY} — the meter is a bar whose filled extent grows ` +
      `with it from EMPTY at 0 (specs/ui.md); the strip moved on its own ` +
      `across one frame in ${drift.count} samples`,
  );
  assertGreaterThan(
    filledAtFull,
    filledAtHalf,
    `samples the meter painted at RESONANCE_MAX (${RESONANCE_MAX}) against ` +
      `the ${filledAtHalf} it painted at ${HALF} — the filled extent GROWS ` +
      "with the meter, to full at RESONANCE_MAX (specs/ui.md)",
  );
});
