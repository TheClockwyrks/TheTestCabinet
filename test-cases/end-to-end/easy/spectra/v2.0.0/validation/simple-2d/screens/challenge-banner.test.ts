// Spectra — screens/challenge-banner: a challenge stage announces itself.
//
// THE RULE. `specs/ui.md`, on `stageIntro`: "on a challenge stage it draws
// `CHALLENGE_BANNER` (`CHALLENGING STAGE`) as well". `specs/stages.md` fixes which
// stages those are: `isChallengeStage(stage)` is `stage % CHALLENGE_EVERY === 0`,
// with `CHALLENGE_EVERY` (`3`).
//
// BOTH HALVES OF ONE REQUIREMENT. The banner is what tells a player that the stage
// ahead is a flyover rather than a wave, so a banner drawn on every stage announces
// nothing at all. This point therefore reads the same screen twice, at the same
// hold, changing only the stage: `CHALLENGE_STAGE` (`3`), where the banner is
// required, and `STANDARD_STAGE` (`1`), where it is not. That is one requirement read
// in one direction — the banner marks a challenge stage — rather than two: a build
// that draws no banner at all and a build that draws one always both fail it, and
// each fails on the assertion that names what it did.
//
// THE STAGE IS POSED, NOT PLAYED TO. `setStage` is what `specs/instrumentation.md`
// provides for exactly this, and it "spawns nothing and clears nothing", so the
// intro is read at the stage it names without three stages of play in front of it.
// `isChallenge` is read back off the snapshot at each pose, so the check is held
// against the stage the BUILD believes it is on.
//
// THE HOLD IS POSED FULL at each stage, so the screen cannot give way underneath
// either reading; how long it really holds is `screens/intro-gives-way`'s point.
//
// WHAT IS NOT ASSERTED. What a challenge stage IS — the groups, the bands, the
// flyover — is the `stages` group's; what the intro says about the stage number is
// `screens/stage-intro-names-stage`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_BANNER,
  STAGE_INTRO_HOLD,
  isChallengeStage,
} from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";

/** A stage `specs/stages.md` makes a challenge stage, and one it does not. */
const CHALLENGE_STAGE = 3;
const STANDARD_STAGE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the challenge banner on a challenge stage's intro and not otherwise", async () => {
  h.debug.setScreen("stageIntro");
  h.debug.setStage(CHALLENGE_STAGE);
  h.debug.setPhaseTimer(STAGE_INTRO_HOLD);
  await h.advance(1);

  const challenge = h.snapshot();
  assertEqual(challenge.screen, "stageIntro", "the game is on the stage intro");
  assertEqual(
    challenge.isChallenge,
    true,
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage: isChallengeStage ` +
      "is stage % CHALLENGE_EVERY === 0 (specs/stages.md)",
  );

  const onChallenge = await drawFrame(h);
  captureStill(h, "banner");

  assertTrue(
    drewText(onChallenge, CHALLENGE_BANNER),
    "the challenge stage's intro drawing CHALLENGE_BANNER " +
      `(${CHALLENGE_BANNER}) (specs/ui.md)`,
  );

  // The same screen, the same hold, one stage number different.
  h.debug.setStage(STANDARD_STAGE);
  h.debug.setPhaseTimer(STAGE_INTRO_HOLD);
  await h.advance(1);

  const standard = h.snapshot();
  assertEqual(standard.screen, "stageIntro", "still on the stage intro");
  assertEqual(
    standard.isChallenge,
    isChallengeStage(STANDARD_STAGE),
    `stage ${String(STANDARD_STAGE)} is a standard stage (specs/stages.md)`,
  );

  const onStandard = await drawFrame(h);

  assertEqual(
    drewText(onStandard, CHALLENGE_BANNER),
    false,
    "a standard stage's intro drawing no CHALLENGE_BANNER — specs/ui.md draws " +
      "it on a challenge stage, so a banner drawn on every stage announces " +
      "nothing",
  );
});
