// campaign/completing-unlocks-the-next — finishing a challenge opens the next one,
// and only the next one.
//
// THE RULE. "Completing challenge `n` unlocks challenge `n + 1` when the course
// holds one" (`specs/modes/campaign.md`, Progression), and the completion is what
// does it: a boundary at which every target is reached "completes the run, records
// the metrics, marks the challenge solved, and unlocks what its mode unlocks"
// (`specs/instrumentation.md`, the `completion` faculty; `specs/simulation.md`,
// Completion and metrics). The snapshot carries the unlocking as
// `campaign.unlockedCount`, "how many are open".
//
// SO THE FIGURE IS EXACT. Challenge `1` is the challenge at index `0`, and it
// begins as the only open one — "`campaign.unlockedCount` | `1`". Completing it
// unlocks challenge `2` and NOTHING FURTHER, so the count is exactly `2`
// afterwards: a build that opened the whole course on the first completion fails
// here as surely as one that opened nothing.
//
// THE WORLD. The course is put back to its opening state, the first challenge is
// opened with the build's own reference solution on it, and the run is left to
// complete. The reference is used because it is the machine the specification
// guarantees completes this challenge; what completes the run is not this point's
// business, only what the completion then unlocks.
//
// THE VERDICT. `campaign.unlockedCount` is `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

it("raises the unlocked count to exactly two when the first challenge is completed", async () => {
  await h.debug.reset();
  const opening = await h.snapshot();
  assertGreaterThan(
    opening.campaign.count,
    1,
    "the course holds a challenge after its first, which is the challenge this " +
      "completion is required to unlock",
  );
  await h.debug.setUnlockedCount(1);

  await complete(0, await referenceSolution(h, "campaign", 0));

  await openSelect(h, "campaign");
  await captureStill(h, "unlocked");

  assertEqual(
    (await h.snapshot()).campaign.unlockedCount,
    2,
    "completing challenge 1 unlocks challenge 2 and unlocks nothing beyond it",
  );
});
