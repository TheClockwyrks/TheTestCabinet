// campaign/completing-marks-solved — finishing a challenge marks it solved.
//
// THE RULE. A completing boundary "marks the challenge solved"
// (`specs/instrumentation.md`, the `completion` faculty; `specs/simulation.md`,
// Completion and metrics), and "A challenge stays unlocked, and stays marked
// solved, for the rest of the session" (`specs/modes/campaign.md`, Progression).
// The snapshot carries the mark as `campaign.solved`, "ascending indices"
// (`specs/instrumentation.md`, Snapshot shape), and the surface says the same of
// the set it poses: `setSolved` leaves it "ascending and free of duplicates".
//
// SO THE SET IS READ WHOLE, AND IN ORDER. The world is posed with a LATER
// challenge already marked, so the mark the completion adds has to be inserted
// BEFORE an existing entry rather than pushed onto the end. A build that appends
// the index it just solved reports `[1, 0]` here and fails; a build that keeps the
// set ascending reports `[0, 1]`. Reading the whole set also decides that the
// completion marked the challenge that was run and no other.
//
// THE WORLD. The course is put back to its opening state, challenge 2 is marked
// solved through the surface — "Neither operation touches progress"
// (`specs/instrumentation.md`) applies to the challenge operations, and `setSolved`
// is the operation that does touch it — and then challenge 1 is completed on the
// build's own reference solution.
//
// THE VERDICT. `campaign.solved` is `[0, 1]`: the completed challenge's index is
// in it, the posed one is still in it, and the set is ascending.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS } from "../constants";
import type { Solution } from "../formats";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  openSelect,
  referenceSolution,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: it is how few frames the reference's cycle budget costs.
 */
const FAST_SPEED = SPEEDS.length - 1;

/**
 * How many cycles one call to the clock covers. The budget is walked in steps
 * rather than in one span so a run that finishes early costs the frames it needed;
 * "the span is the same however it is divided" (`specs/instrumentation.md`), so
 * nothing the run decides turns on this figure.
 */
const CYCLES_PER_STEP = 25;

/**
 * Open a SHIPPED campaign challenge on `machine`, completion allowed, and start it.
 *
 * `openChallenge` is what makes this the course's own challenge rather than a
 * document: "The snapshot reports it under that `mode` and `index`"
 * (`specs/instrumentation.md`), where `loadChallenge` "reports its `source` as
 * `"custom"`" and "Completing a challenge whose source is `"custom"` touches no
 * progress and no record". Every point below is about progress, so every one of
 * them opens the challenge this way.
 */
async function startCampaignRun(
  index: number,
  machine: Solution,
): Promise<void> {
  await openChallenge(h, "campaign", index);
  await loadMachine(h, machine);
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
}

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, CYCLES_PER_STEP);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

/**
 * Complete a shipped campaign challenge on `machine`, and answer the finished run.
 *
 * The completion itself is a posing step here rather than a verdict: a challenge's
 * reference solution is required to be one "whose run completes without faulting
 * within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start"
 * (`specs/modes/campaign.md`), and a build whose reference never completes leaves
 * this point's world unposed, which fails it.
 */
async function complete(
  index: number,
  machine: Solution,
): Promise<OrrerySnapshot> {
  await startCampaignRun(index, machine);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `campaign challenge ${index + 1} completes within CAMPAIGN_REFERENCE_CYCLES ` +
      "(600) cycles on the machine this point runs, which is the world it decides in",
  );
  return finished;
}

it("adds the completed challenge to the solved set, keeping it ascending", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    1,
    "the course holds a second challenge, which is the mark the completed one " +
      "has to be inserted ahead of",
  );
  await h.debug.setSolved("campaign", 1, true);
  assertDeepEqual(
    (await h.snapshot()).campaign.solved,
    [1],
    "the world this point decides in has challenge 2 marked and challenge 1 not",
  );

  await complete(0, await referenceSolution(h, "campaign", 0));

  await openSelect(h, "campaign");
  await captureStill(h, "solved-row");

  const solved = (await h.snapshot()).campaign.solved;
  assertDeepEqual(
    solved,
    [0, 1],
    "completing challenge 1 adds its index to the solved set, which stays " +
      "ascending and keeps the mark that was already there",
  );
  assertEqual(
    solved.every((index, at) => at === 0 || index > (solved[at - 1] ?? -1)),
    true,
    "the solved set is reported as ascending indices",
  );
});
