// campaign/unlock-stops-at-the-last-challenge — finishing the finale opens nothing,
// because there is nothing after it.
//
// THE RULE. "Completing challenge `n` unlocks challenge `n + 1` WHEN THE COURSE
// HOLDS ONE" (`specs/modes/campaign.md`, Progression). The last challenge of the
// course is the one the clause excludes, so its completion unlocks nothing:
// `campaign.unlockedCount` is already the course length and stays there. The
// snapshot's own bound says the same thing from the other side —
// `setUnlockedCount(n)` "Sets how many campaign challenges are open, `1` to the
// shipped course length" (`specs/instrumentation.md`) — so there is no count above
// `campaign.count` for a completion to reach, and nothing in the rule sends the
// count back to `1` either.
//
// THE WORLD. The whole course is opened, its last challenge is entered with the
// build's own reference solution on it, and the run is left to complete. The course
// is opened first because a locked finale could not be reached in play at all;
// `setUnlockedCount` is the operation the specification gives for exactly this.
//
// THE VERDICT. `campaign.unlockedCount` is still `campaign.count`: it has not grown
// past the course, and it has not wrapped back to `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
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

it("leaves the unlocked count at the course length when the last challenge is completed", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    1,
    "the course holds more than one challenge, so a count that wrapped to 1 " +
      "would read differently from a count that stopped at the last challenge",
  );
  await h.debug.setUnlockedCount(count);

  const finale = count - 1;
  await complete(finale, await referenceSolution(h, "campaign", finale));

  await openSelect(h, "campaign");
  await captureStill(h, "finale-solved");

  const after = (await h.snapshot()).campaign.unlockedCount;
  assertEqual(
    after,
    count,
    "the course holds no challenge after its last, so completing it unlocks " +
      "nothing and the unlocked count stays at the course length",
  );
  assertNotEqual(
    after,
    1,
    "completing the last challenge does not wrap the course back to challenge 1",
  );
});
