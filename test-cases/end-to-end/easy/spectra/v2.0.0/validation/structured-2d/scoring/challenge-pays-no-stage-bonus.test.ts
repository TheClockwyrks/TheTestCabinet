// scoring/challenge-pays-no-stage-bonus — a challenge stage pays no stage bonus.
//
// THE RULE. specs/scoring.md, under the bonus table: `SCORE_STAGE_CLEAR` (`1000`)
// is paid "When a standard stage is cleared", and, said again outright, "A
// challenge stage pays no `SCORE_STAGE_CLEAR`." This point decides that second
// sentence.
//
// THE SCENARIO IS A FLYOVER THAT PAYS FOR NOTHING ELSE. The challenge stage is
// opened and simply left to run: no shot is fired, no discharge is released, and
// the meter stands at `0`, so nothing on the field can be destroyed. Every one of
// the forty drones sweeps across and leaves, which specs/stages.md says removes
// it, and the stage ends "in the moment the last of its drones has left the field
// or been destroyed". A stage that ended having paid nothing per drone and owing
// no `SCORE_PERFECT_BONUS` — the bonus is owed only "When every one of a challenge
// stage's `CHALLENGE_TOTAL` drones was destroyed", and none were — leaves exactly
// one thing that could move the score, and it is the bonus this point is about.
// So the reading is a single number: `0`.
//
// WHY THAT IS THE DISTINGUISHING VALUE. A build that pays every cleared stage
// alike reads `1000` and is named by it. A build that pays the stage's own drones
// something for leaving reads a multiple of that figure, which specs/scoring.md
// forbids under "What pays nothing". A build that counts drones GONE as drones
// DESTROYED and pays the perfect bonus reads `10000` — that build also fails
// `scoring.no-perfect-bonus-when-missed`, which is the point that is about it.
//
// TWO WORLD GATES ARE SHUT, AND NEITHER IS THIS POINT'S. specs/stages.md says a
// challenge stage launches no dive and that "A challenge drone's body costs no
// life", so shutting `diveLaunching` and the ship's contact test removes nothing a
// conforming build would have done — while a build that is wrong about either
// could otherwise end the run before the flyover finishes and leave this point
// with no stage's end to read. THE WAVE'S ENTRY GATE STAYS OPEN, because the
// wave's own release on the `ENTER_GROUP_GAP` schedule is what runs the flyover.
// Nothing else is posed: the sweeps, their timing and their removal are the
// build's own.
//
// WHAT THIS DOES NOT DECIDE. That a STANDARD stage's clear pays the bonus is
// `scoring.stage-clear-bonus` — the opposite direction, so a build that never
// pays it fails there and passes here. That the flyover ends at all is `stages`'s,
// and it is asserted below as the ground this reading stands on.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_TOTAL,
  SCORE_STAGE_CLEAR,
} from "../../src/constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The stage the flyover is opened on: the first stage `isChallengeStage(stage)`
 * — `stage % CHALLENGE_EVERY === 0` (specs/stages.md) — is true of.
 */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

/**
 * Frames of game time the whole flyover is given to cross and leave.
 *
 * specs/stages.md releases the last of the `CHALLENGE_GROUPS` (`5`) groups
 * `ENTER_GROUP_GAP * 4` (`2.4`) seconds in, and each group "leaves it within eight
 * seconds of the group's release" — so a conforming flyover is over by `10.4`
 * seconds. Twenty is nearly twice that, which leaves a build flying the slowest
 * conforming sweeps room to spare. It is a budget, not a threshold: nothing is
 * read from how long the flyover took.
 */
const FLYOVER_FRAMES = ticksFor(20);

/**
 * How often the sweep looks, in frames.
 *
 * The flyover's end is a state that persists once reached, so a coarse sample
 * finds it just as surely as a per-frame one and costs a twentieth of the
 * snapshots. Nothing is read from WHEN it was found.
 */
const POLL_FRAMES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no SCORE_STAGE_CLEAR when a challenge stage finishes", async () => {
  h.debug.reset();
  await startStage(h, CHALLENGE_STAGE);
  // Neither belongs to a challenge stage (specs/stages.md: no drone dives, and a
  // challenge drone's body costs no life), and neither is what this point reads.
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "inWave",
    "precondition: the stage's intro gave way to the live flyover " +
      "(specs/stages.md)",
  );
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

  const flown = await h.until((snapshot) => snapshot.drones.length === 0, {
    maxFrames: FLYOVER_FRAMES,
    poll: POLL_FRAMES,
  });

  // The score a whole challenge stage left behind, with nothing destroyed.
  captureStill(h, "none");

  assertTrue(
    flown.hit,
    `precondition: every drone of the flyover left the field within ` +
      `${FLYOVER_FRAMES} frames (specs/stages.md: each group leaves the field ` +
      `within eight seconds of the group's release, the last released 2.4 ` +
      `seconds in)`,
  );

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "stageCleared",
    "precondition: the stage ended once the last of its drones had left the " +
      "field, and opened the stage-cleared interstitial (specs/stages.md)",
  );
  assertEqual(
    after.score,
    0,
    `the score after a challenge stage finished with nothing destroyed ` +
      `(specs/scoring.md: a challenge stage pays no SCORE_STAGE_CLEAR, ` +
      `${SCORE_STAGE_CLEAR}, and SCORE_PERFECT_BONUS is owed only when every ` +
      `one of its CHALLENGE_TOTAL drones was destroyed)`,
  );
});
