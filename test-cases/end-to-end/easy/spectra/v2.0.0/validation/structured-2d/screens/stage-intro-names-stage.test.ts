// Spectra — screens/stage-intro-names-stage: the intro names the stage.
//
// THE RULE. `specs/ui.md`, on `stageIntro`: "It draws `HUD_STAGE_LABEL` (`STAGE`) and
// the stage's number." Both are the specification's own copy, so both are assertable
// exactly as written; where on the screen either sits, and at what size or colour, is
// the build's and nothing here reads it.
//
// THE DISTINGUISHING STAGE. `POSED_STAGE` (`7`) rather than `1`, because `1` is the
// stage a fresh run already carries and a build that drew a stage number it never
// read would be indistinguishable from a correct one there. `7` is also not a number
// anything else on a fresh run's screen draws: the score is `0`, the lives are
// `START_LIVES` (`3`), and the meter is empty. And it is a standard stage rather than
// a challenge one (`CHALLENGE_EVERY` is `3`), so `CHALLENGE_BANNER` —
// `screens/challenge-banner`'s point — is not in play.
//
// THE HOLD IS POSED FULL. `setPhaseTimer(STAGE_INTRO_HOLD)` leaves the whole
// `2.0`-second hold ahead of the two frames this check runs, so the screen cannot give
// way underneath the reading. How long that hold really lasts is
// `screens/intro-gives-way`'s point, not this one's.
//
// HOW THE NUMBER IS READ. Every run of text the frame drew, either as its digits taken
// together (`STAGE 7`, `07`) or as a run of digits with no other digit against it
// (`7 / 12`), which covers both ways a build may have composed the readout without
// asserting one.
//
// WHAT IS NOT ASSERTED. That the intro gives way, which is `screens/intro-gives-way`'s;
// the banner a challenge stage adds, which is `screens/challenge-banner`'s; and the
// HUD's own stage readout during play, which is `screens/hud-stage`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  HUD_STAGE_LABEL,
  STAGE_INTRO_HOLD,
  isChallengeStage,
} from "../../src/constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  drewText,
  type Harness,
} from "../harness";
import { drawFrame, numberRuns } from "./reading";

/** The stage the intro is posed at: not `1`, not a challenge stage. */
const POSED_STAGE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the stage label and the stage's number on the stage intro", async () => {
  h.debug.setStage(POSED_STAGE);
  h.debug.setScreen("stageIntro");
  h.debug.setPhaseTimer(STAGE_INTRO_HOLD);
  await h.advance(1);

  const posed = h.snapshot();
  assertEqual(posed.screen, "stageIntro", "the game is on the stage intro");
  assertEqual(posed.stage, POSED_STAGE, "posed at the stage it should name");
  assertEqual(
    posed.isChallenge,
    isChallengeStage(POSED_STAGE),
    `stage ${String(POSED_STAGE)} is a standard stage, so nothing a challenge ` +
      "stage adds is on this screen (specs/stages.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "intro");

  assertTrue(
    drewText(calls, HUD_STAGE_LABEL),
    `the stage intro drawing HUD_STAGE_LABEL (${HUD_STAGE_LABEL}) (specs/ui.md)`,
  );
  assertGreaterThan(
    numberRuns(drawnTextSpans(h), POSED_STAGE).length,
    0,
    `the stage intro drawing the stage's number (${String(POSED_STAGE)}) ` +
      "beside that label (specs/ui.md)",
  );
});
