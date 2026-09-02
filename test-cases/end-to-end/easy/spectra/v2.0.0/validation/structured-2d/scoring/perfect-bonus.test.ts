// scoring/perfect-bonus — a perfect challenge stage pays its bonus.
//
// THE RULE. specs/scoring.md's bonus table: `SCORE_PERFECT_BONUS` (`10000`) is
// paid "When every one of a challenge stage's `CHALLENGE_TOTAL` drones was
// destroyed". specs/stages.md puts `CHALLENGE_TOTAL` at `40` and ends the stage
// "in the moment the last of its drones has left the field or been destroyed". So
// the reading is what the score gained OVER the per-drone total once all forty
// were destroyed.
//
// THE BONUS IS MEASURED, NOT ASSUMED. The first drone is destroyed on its own and
// the score it left is kept as the build's OWN per-drone figure; the other
// thirty-nine follow; and the bonus is what the final score holds above forty of
// that figure. Nothing here therefore depends on the build paying
// `SCORE_CHALLENGE_DRONE` — a build with the wrong per-drone figure loses
// `scoring.challenge-drone` and keeps this point, which is what "one requirement
// in one direction" asks for. It also means the arithmetic cannot be satisfied by
// a build that simply pays a very large figure per drone.
//
// THE READING IS THE FIGURE ITSELF, NOT MERELY THAT SOMETHING WAS PAID.
// `specs/scoring.md` fixes `SCORE_PERFECT_BONUS` at one number and closes the
// section with "Nothing else adds to the score", so on a challenge stage every one
// of whose drones was destroyed the surplus over the per-drone total is exactly
// that number — which is what the review item's own description states. A build
// that pays no bonus reads `0`, one that pays a bonus per drone reads a multiple,
// one that pays the stage-clear figure instead reads `1000`, and one that pays an
// inflated bonus reads whatever it inflated it to; each is named by the failure.
// A build that pays the bonus AND wrongly adds `SCORE_STAGE_CLEAR` on top reads
// `11000` and loses this point as well as `scoring/challenge-pays-no-stage-bonus`,
// which is the price of reading the figure rather than a floor: on this one
// scenario that build's total really is wrong, and a floor here would let a build
// paying twice the bonus through unremarked.
//
// THE FORTY ARE THE GAME'S OWN, AND THEY ARE DESTROYED ONE BY ONE. Only the game
// can build a flyover, so {@link openWave} runs stage `CHALLENGE_EVERY` (`3`) out
// of its intro and holds every drone of it still — leaving the wave's own entry
// running, for the reason `wave.ts` states, since a stage's end is the wave's own
// event; {@link destroyDrone} then brings each drone to one clear spot and shoots
// it. Every drone the stage built is destroyed, so
// "every one of a challenge stage's CHALLENGE_TOTAL drones" is true under any
// reading of the phrase, and the stage's end is reached by the build's own rule
// rather than by anything this check posed.
//
// WHAT THIS DOES NOT DECIDE. The per-drone figure is `scoring.challenge-drone`;
// that no `SCORE_STAGE_CLEAR` rides along is
// `scoring.challenge-pays-no-stage-bonus`; that a MISSED drone withholds the bonus
// is `scoring.no-perfect-bonus-when-missed`.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_TOTAL,
  SCORE_PERFECT_BONUS,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { destroyDrone, openWave } from "./wave";

/**
 * The stage the flyover is opened on: the first stage `isChallengeStage(stage)`
 * — `stage % CHALLENGE_EVERY === 0` (specs/stages.md) — is true of.
 */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds SCORE_PERFECT_BONUS above the per-drone total when every drone is destroyed", async () => {
  const opened = await openWave(h, CHALLENGE_STAGE);

  assertEqual(
    opened.isChallenge,
    true,
    `precondition: stage ${CHALLENGE_STAGE} is a challenge stage ` +
      `(specs/stages.md: stage % CHALLENGE_EVERY === 0)`,
  );
  assertEqual(opened.score, 0, "precondition: the run opens with a score of 0");
  assertLength(
    opened.drones,
    CHALLENGE_TOTAL,
    `precondition: the flyover holds CHALLENGE_TOTAL drones (specs/stages.md: ` +
      `CHALLENGE_GROUPS groups of CHALLENGE_PER_GROUP)`,
  );

  const ids = opened.drones.map((drone) => drone.id);

  // The first kill on its own, so what the build pays for ONE challenge drone is
  // known before the other thirty-nine are added to it.
  const afterFirst = await destroyDrone(h, ids[0]);
  const perDrone = afterFirst.score;

  let after = afterFirst;
  for (const id of ids.slice(1)) after = await destroyDrone(h, id);

  // The score a whole flyover paid, on the stage-cleared screen it opened.
  captureStill(h, "bonus");

  assertLength(
    after.drones,
    0,
    "precondition: every drone of the flyover was destroyed",
  );
  assertEqual(
    after.screen,
    "stageCleared",
    "precondition: the stage ended once the last of its drones was destroyed " +
      "(specs/stages.md)",
  );

  const bonus = after.score - CHALLENGE_TOTAL * perDrone;
  // EXACTLY the bonus, not merely at least it. `specs/scoring.md` fixes
  // SCORE_PERFECT_BONUS at one figure and closes with "Nothing else adds to the
  // score", so a build that pays an inflated bonus, or that adds anything on top of
  // the per-drone total when a challenge stage is cleared, is wrong in the same way
  // as one that pays nothing. The per-drone rate stays isolated because it is
  // subtracted out, and the stage-clear side is
  // `scoring/challenge-pays-no-stage-bonus`'s point.
  assertEqual(
    bonus,
    SCORE_PERFECT_BONUS,
    `the score above the per-drone total after all ${CHALLENGE_TOTAL} drones ` +
      `of the challenge stage were destroyed (specs/scoring.md: ` +
      `SCORE_PERFECT_BONUS, ${SCORE_PERFECT_BONUS}, is paid when every one of ` +
      `a challenge stage's CHALLENGE_TOTAL drones was destroyed); the build ` +
      `paid ${perDrone} per drone and finished on ${after.score}`,
  );
});
