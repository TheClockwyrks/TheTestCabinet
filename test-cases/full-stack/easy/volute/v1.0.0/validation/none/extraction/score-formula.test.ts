// extraction/score-formula — an extraction of three cores at chain step 1 adds
// exactly 30 to the score.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Score": "An extraction of `n`
// cores at chain step `k` adds `10 x n x k` to the score, where `n` counts every
// core the extraction removed. The score updates on the tick the extraction
// resolves." And "The chain step": "The chain step `k` is an integer that is 1
// when a level begins", with an "Extraction on an insertion" taking the value 1.
// So the first insertion extraction of a fresh level pays `10 x 3 x 1` = 30.
// `extractionScore(n, k)` in constants.ts is that formula, not a copied number.
//
// THE DRIVE is extract-three's: one segment of halide, halide, cobalt posed on
// the straight top run with the quota exhausted, and a halide released straight
// up the field into it. What that check reads as a count, this one reads as a
// score.
//
// WHY THE COUNT IS ASSERTED TOO. `10 x n x k` is one figure with three unknowns
// in it. A build that removed six cores at step 1, or three at step 2 with the
// per-core figure halved, would also land on a number a bare score reading could
// not tell apart from the right one. So the check pins `n` — three cores left the
// channel — and `k` — the level opened at chain step 1 — and then reads the score
// the formula fixes from them.
//
// THE SCORE IS READ AS A DIFFERENCE rather than as an absolute, so the point
// decides the extraction's payment rather than also deciding whether the opening
// score was zero. What a level start leaves the score at is progression's.
//
// NO TOLERANCE IS NEEDED. The score is a whole number the specification fixes
// exactly; nothing here is integrated over ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { extractionScore, MIN_RUN, OPENING_AIM } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/** The head of the posed segment, at `(420, 40)` on specs/channel.md's first leg. */
const HEAD_S = 380;

/** The pair a seated halide completes into a run of three. */
const POSED = ["halide", "halide", "cobalt"] as const;

/** Ticks of the aftermath kept in the replay, so the clip shows the score standing. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays 10 x 3 x 1 for a three-core extraction at chain step 1", async () => {
  await poseHall(h, {
    cores: spacedRun(HEAD_S, POSED),
    loaded: "halide",
  });
  const before = await h.snapshot();
  assertEqual(coreCount(before), POSED.length, "the posed segment");
  // "The chain step `k` is an integer that is 1 when a level begins", and this
  // hall is a level start with no extraction behind it, so `k` is 1.
  assertEqual(before.chainStep, 1, "the chain step a level opens at");

  await fireAt(h, OPENING_AIM);
  const shot = await captureReplay(h, "score", async () => {
    const resolved = await driveShot(h);
    await h.step(AFTERMATH_TICKS);
    return resolved;
  });

  assertTrue(shot.landed, "the fired core to reach the channel");
  // `n` is 3: the seated core made four on the channel and one is left.
  assertEqual(
    coreCount(shot.snapshot),
    POSED.length + 1 - MIN_RUN,
    "cores left after a three-core extraction",
  );
  // `k` is still 1: "Extraction on an insertion | 1".
  assertEqual(
    shot.snapshot.chainStep,
    1,
    "the chain step an insertion scores at",
  );
  // And with `n` = 3 and `k` = 1 fixed, "10 x n x k" is 30.
  assertEqual(shot.snapshot.score - before.score, extractionScore(MIN_RUN, 1));
});
