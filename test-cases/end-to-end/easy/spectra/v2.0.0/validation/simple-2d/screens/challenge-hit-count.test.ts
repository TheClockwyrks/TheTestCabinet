// Spectra — screens/challenge-hit-count: an imperfect challenge stage reports its
// count.
//
// THE RULE. `specs/ui.md`, on what `stageCleared` reports: after "A challenge
// stage in which a drone survived" it draws "The count of drones destroyed" —
// rather than the `PERFECT_TEXT` a flyover taken whole earns, which is
// `screens/challenge-perfect-result`'s point.
//
// THE SCREEN IS POSED, NOT FLOWN TO. `specs/instrumentation.md` gives the surface
// `setChallengeHits`, which sets the current challenge stage's tally of drones
// destroyed and nothing else: it destroys nothing and pays nothing. So the
// scenario this point decides is reached directly — a challenge stage, a tally
// short of the flyover's total, and the interstitial on screen. Flying the
// flyover instead would fold its path, its release schedule, the removal-on-exit
// rule and the reach of whatever destroyed its drones into a point about what one
// screen DRAWS, and a build with a correct interstitial and a slightly-off
// entrance would lose this point to a defect that belongs elsewhere.
//
// THE COUNT IS A VALUE NOTHING ELSE ON THE SCREEN CARRIES. `HITS` is `7`, and
// every other figure the screen can draw is posed away from it: the score at
// `POSED_SCORE` (`3200`), the stage at `CHALLENGE_STAGE` (`3`), the lives at
// `START_LIVES` (`3`), and the flyover's own `CHALLENGE_TOTAL` (`40`). A build
// drawing the total, the count of survivors, the stage, the score or a hard-coded
// number therefore reads as something other than `7`.
//
// AND A TALLY SHORT OF THE TOTAL IS WHAT MAKES THIS THE SURVIVED CASE.
// `specs/ui.md` splits the two readings by whether every drone was destroyed and
// `specs/stages.md` fixes the flyover at `CHALLENGE_TOTAL` (`40`) drones, so
// seven of forty is a challenge stage a drone survived.
//
// WHAT IS NOT ASSERTED. How long the screen holds, which is
// `screens/stage-cleared-hold`'s; what a challenge kill PAYS, which is the
// `scoring` group's; what the screen says when nothing survived, which is
// `screens/challenge-perfect-result`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  STAGE_CLEARED_HOLD,
  START_LIVES,
  isChallengeStage,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startPosed,
  type Harness,
} from "../harness";
import { drewNumber } from "./reading";

/** The stage posed: the first challenge stage (specs/stages.md). */
const CHALLENGE_STAGE = 3;

/** The tally the run carries into the interstitial, short of CHALLENGE_TOTAL. */
const HITS = 7;

/** A score no digit run of which reads as HITS. */
const POSED_SCORE = 3200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the count of drones destroyed after a challenge stage one survived", async () => {
  startPosed(h);
  h.debug.setStage(CHALLENGE_STAGE);
  h.debug.setChallengeHits(HITS);
  h.debug.setScore(POSED_SCORE);
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
    HITS,
    `snapshot().challengeHits after setChallengeHits(${String(HITS)}), the ` +
      "tally this screen reports — short of CHALLENGE_TOTAL " +
      `(${String(CHALLENGE_TOTAL)}), so a drone survived (specs/ui.md)`,
  );
  assertEqual(
    posed.score,
    POSED_SCORE,
    "the score, posed away from the count so the number below can only be the " +
      "count",
  );
  assertEqual(
    posed.lives,
    START_LIVES,
    "the lives, which START_LIVES leaves away from the count too",
  );

  const calls = await drawFrame(h);
  captureStill(h, "count");

  assertTrue(
    drewNumber(calls, HITS),
    "the stage-cleared screen drawing the count of drones destroyed " +
      `(${String(HITS)} of CHALLENGE_TOTAL ${String(CHALLENGE_TOTAL)}) after ` +
      "a challenge stage in which a drone survived (specs/ui.md)",
  );
});
