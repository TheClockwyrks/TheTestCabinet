// stages/challenge-every-third — the challenge schedule is every third stage.
//
// specs/stages.md, Challenge stages: "`isChallengeStage(stage)` is
// `stage % CHALLENGE_EVERY === 0`, with `CHALLENGE_EVERY` (`3`), so every third
// stage is a challenge stage rather than a standard wave."
// specs/instrumentation.md reports the answer as the snapshot's `isChallenge`,
// "derived: stage % CHALLENGE_EVERY === 0", and states that it follows `setStage`.
//
// WHAT IS DRIVEN. Nothing but the stage number. The schedule is a function of one
// argument, so the check poses each stage in turn and reads the answer back; no
// wave is built and no frame of play is needed to decide it.
//
// WHY TWELVE STAGES. Four challenge stages and eight standard ones, which is what
// makes every wrong schedule read differently: a build that fires on every stage
// answers true twelve times, one that never fires answers false twelve, one on the
// wrong phase (`stage % 3 === 1`) answers on 1, 4, 7, 10, one on every second
// stage answers six times, and one on every fourth answers on 4, 8, 12. Each is
// named by the first stage it disagrees on rather than by a single count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHALLENGE_EVERY, isChallengeStage } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The stages the schedule is read across, `1` to `12`. */
const STAGES = Array.from({ length: 12 }, (_, index) => index + 1);

/** The stage the kept picture is taken on: the first the schedule names. */
const SHOWN_STAGE = CHALLENGE_EVERY;

/** Frames run before the picture is kept, so the canvas carries that stage. */
const SETTLE_FRAMES = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("names every third stage a challenge stage, and no other", async () => {
  await startPosed(harness);

  for (const stage of STAGES) {
    await harness.debug.setStage(stage);
    const snapshot = await harness.snapshot();
    assertEqual(
      snapshot.stage,
      stage,
      `the stage that was posed (specs/instrumentation.md)`,
    );
    assertEqual(
      snapshot.isChallenge,
      isChallengeStage(stage),
      `whether stage ${stage} is a challenge stage, stage % ${CHALLENGE_EVERY} === 0 (specs/stages.md)`,
    );
  }

  await harness.debug.setStage(SHOWN_STAGE);
  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "schedule");
});
