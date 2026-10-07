// campaign/replay-never-relocks — playing a solved challenge again changes no
// unlock state.
//
// THE RULE. "Completing a challenge again is a replay" and "A challenge stays
// unlocked, and stays marked solved, for the rest of the session"
// (`specs/modes/campaign.md`, Progression). Nothing in the rule takes anything
// back, so the second completion of a challenge leaves `campaign.unlockedCount`
// and `campaign.solved` exactly as the first one left them: nothing relocks,
// nothing is unmarked, and no challenge beyond the next is opened by the repeat.
//
// THE SHAPE OF THE CHECK IS A BEFORE AND AN AFTER over the SAME challenge and the
// SAME machine. The first completion is the arrangement: it is what makes the
// second one a replay at all. Only the second is the point, and the two readings
// are compared to each other rather than to figures written down here, so the check
// asks what the replay CHANGED rather than what the first run happened to reach.
//
// THE VERDICT. The unlocked count and the solved set after the replay are the ones
// the first completion left.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
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
 * only: a cycle is `1 / SPEEDS[speed]` seconds, so it is the shortest span of
 * game time the budget's cycles can be driven as.
 */
const FAST_SPEED = SPEEDS.length - 1;

/**
 * How many cycles one call to the clock covers, in ONE frame: "a frame may
 * complete several cycles; each runs in full, in order" (`specs/simulation.md`),
 * and "the span is the same however it is divided" (`specs/instrumentation.md`),
 * so nothing the run decides turns on the division. The budget is walked in steps
 * rather than in one span so a run that finishes early costs only the steps it
 * needed.
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
    await advanceCycles(h, CYCLES_PER_STEP, 1);
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

it("leaves the unlocked count and the solved set alone when a solved challenge is replayed", async () => {
  await h.debug.reset();
  const machine = await referenceSolution(h, "campaign", 0);

  await complete(0, machine);
  const solvedOnce = (await h.snapshot()).campaign;
  assertContains(
    solvedOnce.solved,
    0,
    "the first completion marked challenge 1 solved, so running it again is a " +
      "replay rather than a first completion",
  );

  await complete(0, machine);

  await openSelect(h, "campaign");
  await captureStill(h, "after-replay");

  const replayed = (await h.snapshot()).campaign;
  assertEqual(
    replayed.unlockedCount,
    solvedOnce.unlockedCount,
    "a replay unlocks nothing further and relocks nothing, so the unlocked " +
      "count is the one the first completion left",
  );
  assertDeepEqual(
    replayed.solved,
    solvedOnce.solved,
    "a replay unmarks nothing, so the solved set is the one the first " +
      "completion left",
  );
});
