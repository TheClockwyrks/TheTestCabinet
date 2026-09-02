// Spectra — screens/hud-score: the HUD reports the score.
//
// THE RULE. `specs/ui.md` puts the score among the five HUD readouts — "The running
// score, as digits" — and `specs/field.md` puts it in the TOP HUD strip, `y` in
// `[0, HUD_TOP_H]` (`[0, 64]`). This point decides both halves of the one requirement
// "the HUD reports the score": that the digits are drawn in that strip, and that they
// FOLLOW the score rather than being a number the build drew once.
//
// TWO SCORES, BOTH DISTINGUISHING. A single reading cannot tell a readout from a
// constant, so the score is posed twice, at two four-digit numbers neither of which is
// a figure anything else on a posed live wave draws: the stage is `1`, the lives are
// `START_LIVES` (`3`), the meter is empty, and no drone or bullet is on the field.
// After the second pose the first number must be GONE, which is what separates a
// readout that follows the score from one that draws every score it has ever been
// given.
//
// HOW A NUMBER IS READ. Every run of text the frame drew, taken either as its digits
// run together — which is how `SCORE 4270`, `4,270` and `004270` all read as `4270` —
// or as a run of digits with no other digit against it. Both are conformant
// compositions and `specs/ui.md` fixes neither, so both count.
//
// WHICH STRIP IT LANDED IN is read from the anchor the build drew the run at, mapped
// through whatever transform was in force (`drawnTextSpans`), so a HUD drawn at a
// translated origin reads the same as one drawn in stage coordinates.
//
// THE SCORE IS POSED, NOT PLAYED FOR. `setScore` is what `specs/instrumentation.md`
// provides, and it "grants no extra life: this is a precondition", so nothing about the
// run changes but the number under test. What scoring PAYS is the `scoring` group's.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_TOP_H } from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  startPosed,
  type Harness,
} from "../harness";
import { TOP_STRIP, drawFrame, insideBand, numberRuns } from "./reading";

/** The two scores the run is posed at, in the order they are posed. */
const FIRST_SCORE = 4270;
const SECOND_SCORE = 9310;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the score in the top strip and follows it when it changes", async () => {
  startPosed(h);
  h.debug.setScore(FIRST_SCORE);
  await h.advance(1);
  assertEqual(
    h.snapshot().score,
    FIRST_SCORE,
    "the run is posed at the first score (specs/instrumentation.md)",
  );

  await drawFrame(h);
  const first = drawnTextSpans(h);
  captureStill(h, "score");

  const firstRuns = numberRuns(first, FIRST_SCORE);
  assertGreaterThan(
    firstRuns.length,
    0,
    `the HUD drawing the score (${String(FIRST_SCORE)}) as digits (specs/ui.md)`,
  );
  assertTrue(
    firstRuns.some((run) => insideBand(TOP_STRIP, run.y)),
    `the score drawn in the TOP HUD strip, y in [0, ${String(HUD_TOP_H)}] ` +
      "(specs/field.md); it was drawn at y " +
      `${firstRuns.map((run) => run.y.toFixed(0)).join(", ")}`,
  );

  h.debug.setScore(SECOND_SCORE);
  await drawFrame(h);
  assertEqual(
    h.snapshot().score,
    SECOND_SCORE,
    "the run is posed at the second score",
  );

  const second = drawnTextSpans(h);
  const secondRuns = numberRuns(second, SECOND_SCORE);
  assertGreaterThan(
    secondRuns.length,
    0,
    `the HUD drawing the new score (${String(SECOND_SCORE)}) once the score ` +
      "changed — the readout shows the RUNNING score (specs/ui.md)",
  );
  assertTrue(
    secondRuns.some((run) => insideBand(TOP_STRIP, run.y)),
    `the new score drawn in the TOP HUD strip, y in [0, ${String(HUD_TOP_H)}] ` +
      "(specs/field.md)",
  );
  assertEqual(
    numberRuns(second, FIRST_SCORE).length,
    0,
    `the old score (${String(FIRST_SCORE)}) no longer drawn anywhere — the ` +
      "readout follows the score rather than accumulating the ones it has been " +
      "given",
  );
});
