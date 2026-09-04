// Spectra — screens/hud-stage: the HUD reports the stage.
//
// THE RULE. `specs/ui.md` gives the stage readout its content — "`HUD_STAGE_LABEL`
// (`STAGE`) and the current stage's digits" — and `specs/field.md` puts it in the
// TOP HUD strip, `y` in `[0, HUD_TOP_H]` (`[0, 64]`). This point decides the one
// requirement "the HUD reports the stage": the label and the digits are drawn in
// that strip, and the digits FOLLOW the stage.
//
// TWO STAGES, BOTH DISTINGUISHING. A single reading cannot tell a readout from a
// constant, so the stage is posed twice, at `FIRST_STAGE` (`7`) and `SECOND_STAGE`
// (`11`). Neither is `1`, which a fresh run already carries and which a build that
// never read the stage would draw anyway, and neither is a figure anything else on
// a posed live wave draws: the score is `0`, the lives are `START_LIVES` (`3`) and
// the meter is empty. Neither is a challenge stage (`CHALLENGE_EVERY` is `3`), so
// nothing a challenge stage adds is in the reading. After the second pose the
// first number must be GONE.
//
// HOW A NUMBER IS READ. Every run of text the frame drew, taken either as its
// digits run together — which is how `STAGE 7` and `07` both read as `7` — or as
// a run of digits with no other digit against it. Both are conformant
// compositions and `specs/ui.md` fixes neither.
//
// THE STAGE IS POSED, NOT PLAYED TO. `setStage` "spawns nothing and clears
// nothing" (`specs/instrumentation.md`), so the readout is read at the stage it
// names without ten stages of play in front of it. What a stage SCALES is the
// `stages` group's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { HUD_STAGE_LABEL, HUD_TOP_H, isChallengeStage } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  startPosed,
  textDraws,
  type Harness,
} from "../harness";
import { TOP_STRIP, insideBand, numberRuns } from "./reading";

/** The two stages the run is posed at, in the order they are posed. */
const FIRST_STAGE = 7;
const SECOND_STAGE = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the stage label and digits in the top strip and follows the stage", async () => {
  await startPosed(h, { stage: FIRST_STAGE });
  await h.advance(1);
  const posed = await h.snapshot();
  assertEqual(posed.stage, FIRST_STAGE, "the run is posed at the first stage");
  assertEqual(
    posed.isChallenge,
    isChallengeStage(FIRST_STAGE),
    `stage ${FIRST_STAGE} is a standard stage (specs/stages.md)`,
  );

  const first = await h.frameCalls();
  await captureStill(h, "stage");

  assertTrue(
    drewText(first, HUD_STAGE_LABEL),
    `the HUD drawing HUD_STAGE_LABEL (${HUD_STAGE_LABEL}) (specs/ui.md)`,
  );
  const firstRuns = numberRuns(textDraws(first), FIRST_STAGE);
  assertGreaterThan(
    firstRuns.length,
    0,
    `the HUD drawing the current stage's digits (${FIRST_STAGE}) (specs/ui.md)`,
  );
  assertTrue(
    firstRuns.some((run) => insideBand(TOP_STRIP, run.y)),
    `the stage readout drawn in the TOP HUD strip, y in [0, ${HUD_TOP_H}] ` +
      `(specs/field.md); it was drawn at y ` +
      `${firstRuns.map((run) => run.y.toFixed(0)).join(", ")}`,
  );

  await h.debug.setStage(SECOND_STAGE);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).stage,
    SECOND_STAGE,
    "the run is posed at the second stage",
  );

  const second = textDraws(await h.frameCalls());
  assertGreaterThan(
    numberRuns(second, SECOND_STAGE).length,
    0,
    `the HUD drawing the new stage's digits (${SECOND_STAGE}) once the stage ` +
      "changed — the readout shows the CURRENT stage (specs/ui.md)",
  );
  assertEqual(
    numberRuns(second, FIRST_STAGE).length,
    0,
    `the old stage's digits (${FIRST_STAGE}) no longer drawn anywhere — the ` +
      "readout follows the stage",
  );
});
