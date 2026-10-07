// extraction/chain-insertion-resets — an insertion extraction scores at chain step
// 1 whatever step the chain stood at.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "The chain step": "Each extraction
// takes the value this table gives, then scores at it", and the table's first row
// is "Extraction on an insertion | 1". So an insertion extraction takes the chain
// back to 1 before it pays, and specs/extraction.md — "Score" — then pays
// "10 x n x k": three cores at step 1 is 30.
//
// THIS IS THE OTHER DIRECTION FROM chain-increment. That point grades the step a
// merge adds; this one grades the step an insertion takes the chain back to. A
// build can raise a chain correctly and never let it fall, so the two are separate
// points.
//
// THE DRIVE, IN TWO POSES. First the chain is taken to step 2 the only way the
// specification allows — a merge extraction, the "previous step plus 1" row. Then
// the insertion scenario is posed over the hall that left:
// specs/instrumentation.md's `poseTrain` "Replaces every core on the channel with
// the cores given" and leaves "the quota, the pressure, the chain step, the active
// machinery, the projectiles, and the injector... as they are", so the chain
// arrives at step 2 and the insertion has something to reset.
//
// INSIDE THE CHAIN WINDOW. specs/extraction.md resets the step to 1 on its own when
// "`CHAIN_RESET` (2.0 s) elapses with no extraction", so a slow drive would read a
// lapse instead of the rule under test. The insertion lands about 26 ticks after
// the merge, and the check reads the reported chain timer just before the shot
// resolves to confirm the window was still open.
//
// WHY THE PRECONDITION IS ASSERTED. If the merge left the chain at 1, a following
// insertion scoring 30 would say nothing at all — the number would be right for the
// wrong reason. So the check reads the step the merge left before it drives the
// insertion, and the point fails when the hall it needs could not be posed, as
// `writing-debug-apis-and-validators` requires of a validator that cannot reach its
// scenario.
//
// WHY `n` IS PINNED. `10 x n x k` is one number with two unknowns; a build that
// removed six cores at step 1 would pay 60 rather than 30, but one that removed
// three at step 1 and one that removed one and a half at step 2 cannot both be
// ruled out from the score alone. The check reads that exactly three cores left.
//
// NO TOLERANCE IS NEEDED. Both readings — a chain step and a score — are whole
// numbers the specification fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import { extractionScore, MIN_RUN, OPENING_AIM, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  fireAt,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/** The lead segment of the merge pose, at `(540, 40)` on specs/channel.md's first leg. */
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

/** The head of the insertion pose, at `(420, 40)` on the same leg. */
const INSERT_HEAD_S = 380;

/** The pair a seated halide completes into a run of three. */
const INSERT_POSED = ["halide", "halide", "cobalt"] as const;

/** How far the shot's whole flight may run before the check calls it lost. */
const FLIGHT_TICKS = 120; // 2 s, against a flight of about 26 ticks

/** Ticks of the aftermath kept in the replay, so the clip shows the score standing. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the chain back to step 1 and pays 30 for a three-core insertion extraction", async () => {
  // The chain is raised to step 2 the only way the specification allows.
  await poseHall(h, {
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
  });
  const merge = await h.stepUntil(
    (snapshot) => coreCount(snapshot) <= LEAD.length + TRAIL.length - MIN_RUN,
    { maxTicks: APPROACH_TICKS, poll: 1 },
  );
  assertTrue(merge.hit, "a merge extraction to raise the chain");
  assertEqual(
    merge.snapshot.chainStep,
    2,
    "the chain step a merge extraction leaves",
  );

  // The insertion scenario, posed over the hall that merge left. The chain step
  // rides through the pose.
  await h.debug.poseTrain(spacedRun(INSERT_HEAD_S, INSERT_POSED));
  await h.debug.setLoaded("halide");
  const posed = await h.snapshot();
  assertEqual(
    posed.chainStep,
    2,
    "the chain step the insertion is driven from",
  );

  await fireAt(h, OPENING_AIM);
  const flight = await captureReplay(h, "reset", async () => {
    const history = await h.stepWatching(
      FLIGHT_TICKS,
      (snapshot) => (snapshot.projectiles?.length ?? 0) === 0,
    );
    await h.step(AFTERMATH_TICKS);
    return history;
  });

  assertGreaterThanOrEqual(flight.length, 2, "ticks of the shot's flight");
  const before = flight[flight.length - 2];
  const after = flight[flight.length - 1];
  // The shot resolved, and it resolved while the chain was still running rather
  // than after CHAIN_RESET had lapsed on its own.
  assertEqual(
    after.projectiles?.length ?? 0,
    0,
    "the fired core to reach the channel",
  );
  assertGreaterThan(
    before.chainTimer,
    0,
    "seconds left on the chain at the strike",
  );

  // `n` is 3: the seated core made four on the channel and one is left.
  assertEqual(
    coreCount(after),
    INSERT_POSED.length + 1 - MIN_RUN,
    "cores left after the insertion extraction",
  );
  // "Extraction on an insertion | 1", whatever the chain stood at.
  assertEqual(after.chainStep, 1);
  // And at step 1, "10 x n x k" for three cores is 30.
  assertEqual(after.score - posed.score, extractionScore(MIN_RUN, 1));
});
