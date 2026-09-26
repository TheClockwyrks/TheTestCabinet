// Spectra — screens/challenge-perfect-result: a perfect challenge stage says so.
//
// THE RULE. `specs/ui.md`, on what `stageCleared` reports: after "A challenge
// stage in which every drone was destroyed" it draws `PERFECT_TEXT` (`PERFECT!`).
// `specs/stages.md` fixes what "every" means — `CHALLENGE_TOTAL` (`40`) drones,
// in `CHALLENGE_GROUPS` (`5`) groups of `CHALLENGE_PER_GROUP` (`8`).
//
// THE SCREEN IS POSED, NOT FLOWN TO. `specs/instrumentation.md` gives the surface
// `setChallengeHits`, which sets the current challenge stage's tally of drones
// destroyed and nothing else: it destroys nothing and pays nothing. So the
// scenario is reached directly — a challenge stage, a tally standing at
// `CHALLENGE_TOTAL`, and the interstitial on screen. Clearing all forty by flying
// the flyover instead would fold the discharge's reach, the flyover's path and
// its release schedule into a point about what one screen DRAWS, and would need a
// precondition read off the score, which grades a build's challenge scoring here
// as well as in the `scoring` group.
//
// WHAT IS NOT ASSERTED. What the screen reports when a drone SURVIVED, which is
// `screens/challenge-hit-count`'s; how long the screen holds, which is
// `screens/stage-cleared-hold`'s; the bonus a perfect flyover pays, which is
// `scoring/perfect-bonus`'s and is decided on a stage really flown.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  PERFECT_TEXT,
  STAGE_CLEARED_HOLD,
  isChallengeStage,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { drawFrame } from "./reading";

/** The stage posed: the first challenge stage (specs/stages.md). */
const CHALLENGE_STAGE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws PERFECT! after a challenge stage in which every drone was destroyed", async () => {
  startPosed(h);
  h.debug.setStage(CHALLENGE_STAGE);
  h.debug.setChallengeHits(CHALLENGE_TOTAL);
  h.debug.setScreen("stageCleared");
  h.debug.setPhaseTimer(STAGE_CLEARED_HOLD);
  await h.advance(1);

  const posed = h.snapshot();
  assertEqual(
    posed.screen,
    "stageCleared",
    "the stage-cleared interstitial is on screen",
  );
  assertEqual(
    posed.isChallenge,
    isChallengeStage(CHALLENGE_STAGE),
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage (specs/stages.md)`,
  );
  assertEqual(
    posed.challengeHits,
    CHALLENGE_TOTAL,
    "snapshot().challengeHits after setChallengeHits(CHALLENGE_TOTAL) — every " +
      `one of the flyover's ${String(CHALLENGE_TOTAL)} drones was destroyed ` +
      "(specs/stages.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "perfect");

  assertTrue(
    drewText(calls, PERFECT_TEXT),
    `the stage-cleared screen drawing PERFECT_TEXT (${PERFECT_TEXT}) after a ` +
      "challenge stage in which every drone was destroyed (specs/ui.md)",
  );
});
