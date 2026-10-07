// extraction/chain-increment — a merge extraction following an insertion
// extraction scores at the next chain step, so a run of three pays 60.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "The chain step":
//
//   | Extraction on an insertion | 1                       |
//   | Extraction on a merge      | the previous step plus 1 |
//
// and "An insertion-caused extraction therefore scores at step 1, the merge-caused
// extraction that follows it scores at step 2". specs/extraction.md — "Score" —
// then fixes the payment: "An extraction of `n` cores at chain step `k` adds
// `10 x n x k` to the score". Three cores at step 2 is 60. `extractionScore(n, k)`
// in constants.ts is that formula rather than a copied number.
//
// THE DRIVE, IN TWO POSES. First an insertion extraction, which specs/extraction.md
// puts at step 1: one segment of halide, halide, cobalt on the straight top run and
// a halide released straight up the field into it. Then the merge scenario is posed
// over the hall the extraction left — specs/instrumentation.md's `poseTrain`
// "Replaces every core on the channel with the cores given" and leaves "the quota,
// the pressure, the chain step, the active machinery, the projectiles, and the
// injector... as they are", so the chain carries across the pose untouched — and
// its catch-up produces the merge extraction whose payment is read.
//
// THE CHAIN WINDOW IS HELD OPEN. specs/extraction.md — "`CHAIN_RESET` (2.0 s)
// elapses with no extraction | 1" — so a drive that took too long would be reading
// a lapse rather than an increment. The two extractions here are about 26 ticks and
// 23 ticks apart, well inside 2.0 s, and the check reads the reported chain timer
// before the merge to say so rather than trusting the arithmetic.
//
// WHY `n` IS PINNED. `10 x n x k` is one number with two unknowns in it, and a
// build that extracted six cores at step 1 would land on 60 as well. So the check
// reads that the merge removed exactly three cores, and only then reads the score.
//
// NO TOLERANCE IS NEEDED. The score is a whole number the specification fixes
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { extractionScore, MIN_RUN, OPENING_AIM, SPACING } from "../constants";
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

/** The head of the insertion pose, at `(420, 40)` on specs/channel.md's first leg. */
const INSERT_HEAD_S = 380;

/** The pair a seated halide completes into a run of three. */
const INSERT_POSED = ["halide", "halide", "cobalt"] as const;

/** The lead segment of the merge pose, at `(540, 40)` on the same leg. */
const LEAD_HEAD_S = 500;

/** A halide ahead of two cobalt, so the run spanning the join stops there. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** A cobalt at the head with a halide behind it, so the run stops there too. */
const TRAIL = ["cobalt", "halide"] as const;

/** How far behind the merge position the trailing segment starts. */
const GAP = 60;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/** How long the check waits for the catch-up, against about 23 ticks of it. */
const APPROACH_TICKS = 180; // 3 s

/** Ticks of the aftermath kept in the replay, so the clip shows the score standing. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays a merge extraction that follows an insertion extraction at step 2", async () => {
  // The insertion extraction, which specs/extraction.md scores at step 1.
  await poseHall(h, {
    cores: spacedRun(INSERT_HEAD_S, INSERT_POSED),
    loaded: "halide",
  });
  fireAt(h, OPENING_AIM);
  const first = await driveShot(h);
  assertTrue(first.landed, "the fired core to reach the channel");
  assertEqual(
    coreCount(first.snapshot),
    INSERT_POSED.length + 1 - MIN_RUN,
    "cores left after the first extraction",
  );

  // The merge scenario, posed over the hall that extraction left. The chain step
  // and its timer ride through the pose.
  h.debug.poseTrain([
    ...spacedRun(LEAD_HEAD_S, LEAD),
    ...spacedRun(TRAIL_HEAD_S, TRAIL),
  ]);
  const posed = h.snapshot();
  // The chain is still running, so the merge that follows is a chained extraction
  // rather than one after a lapse.
  assertGreaterThan(posed.chainTimer, 0, "seconds left on the chain");

  const merge = await captureReplay(h, "chain", async () => {
    const closed = await h.stepUntil(
      (snapshot) => coreCount(snapshot) <= LEAD.length + TRAIL.length - MIN_RUN,
      { maxTicks: APPROACH_TICKS, poll: 1 },
    );
    await h.step(AFTERMATH_TICKS);
    return closed;
  });

  assertTrue(merge.hit, "the run spanning the join to be extracted");
  // `n` is 3: five cores stood on the channel and two are left.
  assertEqual(
    coreCount(merge.snapshot),
    LEAD.length + TRAIL.length - MIN_RUN,
    "cores left after the merge extraction",
  );
  // And with `n` = 3 fixed, "10 x n x k" at the incremented step is 60.
  assertEqual(merge.snapshot.score - posed.score, extractionScore(MIN_RUN, 2));
});
