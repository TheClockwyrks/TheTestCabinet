// Spectra — screens/hud-stage: the HUD reports the stage.
//
// THE RULE. `specs/ui.md` gives the stage readout its content — "`HUD_STAGE_LABEL`
// (`STAGE`) and the current stage's digits" — and `specs/field.md` puts it in the TOP
// HUD strip, `y` in `[0, HUD_TOP_H]` (`[0, 64]`). This point decides the one
// requirement "the HUD reports the stage": the label and the digits are drawn in that
// strip, and the digits FOLLOW the stage.
//
// TWO STAGES, BOTH DISTINGUISHING. A single reading cannot tell a readout from a
// constant, so the stage is posed twice, at `FIRST_STAGE` (`7`) and `SECOND_STAGE`
// (`11`). Neither is `1`, which a fresh run already carries and which a build that
// never read the stage would draw anyway, and neither is a figure anything else on a
// posed live wave draws: the score is `0`, the lives are `START_LIVES` (`3`) and the
// meter is empty. Neither is a challenge stage (`CHALLENGE_EVERY` is `3`), so nothing
// a challenge stage adds is in the reading. After the second pose the first number
// must be GONE.
//
// HOW A NUMBER IS READ. Every run of text the frame drew, taken either as its digits
// run together — which is how `STAGE 7` and `07` both read as `7` — or as a run of
// digits with no other digit against it. Both are conformant compositions and
// `specs/ui.md` fixes neither.
//
// THE STAGE IS POSED, NOT PLAYED TO. `setStage` "spawns and clears nothing"
// (`specs/instrumentation.md`), so the readout is read at the stage it names without
// ten stages of play in front of it. What a stage SCALES is the `stages` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  isChallengeStage,
} from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  drewText,
  startPosed,
  type Harness,
} from "../harness";
import { TOP_STRIP, drawFrame, insideBand, numberRuns } from "./reading";

/** The two stages the run is posed at, in the order they are posed. */
const FIRST_STAGE = 7;
const SECOND_STAGE = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the stage label and digits in the top strip and follows the stage", async () => {
  startPosed(h);
  h.debug.setStage(FIRST_STAGE);
  await h.advance(1);
  const posed = h.snapshot();
  assertEqual(posed.stage, FIRST_STAGE, "the run is posed at the first stage");
  assertEqual(
    posed.isChallenge,
    isChallengeStage(FIRST_STAGE),
    `stage ${String(FIRST_STAGE)} is a standard stage (specs/stages.md)`,
  );

  const first = await drawFrame(h);
  captureStill(h, "stage");

  assertTrue(
    drewText(first, HUD_STAGE_LABEL),
    `the HUD drawing HUD_STAGE_LABEL (${HUD_STAGE_LABEL}) (specs/ui.md)`,
  );
  const firstRuns = numberRuns(drawnTextSpans(h), FIRST_STAGE);
  assertGreaterThan(
    firstRuns.length,
    0,
    `the HUD drawing the current stage's digits (${String(FIRST_STAGE)}) ` +
      "(specs/ui.md)",
  );
  assertTrue(
    firstRuns.some((run) => insideBand(TOP_STRIP, run.y)),
    "the stage readout drawn in the TOP HUD strip, y in " +
      `[0, ${String(HUD_TOP_H)}] (specs/field.md); it was drawn at y ` +
      `${firstRuns.map((run) => run.y.toFixed(0)).join(", ")}`,
  );

  h.debug.setStage(SECOND_STAGE);
  await drawFrame(h);
  assertEqual(
    h.snapshot().stage,
    SECOND_STAGE,
    "the run is posed at the second stage",
  );

  const second = drawnTextSpans(h);
  assertGreaterThan(
    numberRuns(second, SECOND_STAGE).length,
    0,
    `the HUD drawing the new stage's digits (${String(SECOND_STAGE)}) once the ` +
      "stage changed — the readout shows the CURRENT stage (specs/ui.md)",
  );
  assertEqual(
    numberRuns(second, FIRST_STAGE).length,
    0,
    `the old stage's digits (${String(FIRST_STAGE)}) no longer drawn anywhere ` +
      "— the readout follows the stage",
  );
});
