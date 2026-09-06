// extras/extras-completion-leaves-campaign-unlocks — an Extra's completion is not
// the campaign's business.
//
// THE RULE. A completing run "marks it solved, UNLOCKS WHAT ITS MODE UNLOCKS, and
// updates the challenge's records" (`specs/simulation.md`, Completion and
// metrics) — what ITS mode unlocks, and the Extras unlock nothing: "It is a fixed
// shelf of standalone challenges, open from the start", "Every challenge is
// unlocked from the start" (`specs/modes/extras.md`). The surface says the same
// of the figure this point reads: "`setUnlockedCount(n)` Sets how many CAMPAIGN
// challenges are open ... The Extras lock nothing, as `specs/modes/extras.md`
// states" (`specs/instrumentation.md`). The two modes' progress stands side by
// side in the snapshot, as `campaign` and `extras`, and the challenge an Extra's
// completion "marks solved" and "updates the records" of is that Extra.
//
// THE WORLD IS A CAMPAIGN MID-COURSE. Two challenges open, challenge 1 marked
// solved, and challenge 1 carrying a record of its own — every campaign figure a
// completion writes, posed through `setUnlockedCount`, `setSolved` and
// `setRecord` rather than played, because what this point is about is what an
// Extras run LEAVES ALONE. Then Extras 4 is completed on the build's own
// reference machine, with the completion switch on, and the campaign is read
// again.
//
// THE EXTRA THAT RUNS IS THE FOURTH, and the posed unlocked count is `2`, so the
// two figures cannot agree by accident. The campaign's own rule is "Completing
// challenge `n` unlocks challenge `n + 1`" (`specs/modes/campaign.md`), so a
// build that ran that rule off the Extra's index would open the course as far as
// challenge `5` — a figure the posed `2` tells apart, on any course longer than
// the two challenges opened. A world posed at the resting count, or run on
// Extras 1, would read the same either way and decide nothing.
//
// THE VERDICT. `campaign.unlockedCount`, `campaign.solved` and `campaign.records`
// are exactly what they were before the Extras run, while `extras` shows the run
// really was a completion: the Extra is in its own mode's solved set and carries
// its own record.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
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

/** Extras 4, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 3;

/** How many campaign challenges are posed open before the Extras run. */
const POSED_UNLOCKED = 2;

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
 * Open a SHIPPED Extras challenge on `machine`, completion allowed, and start it.
 *
 * `openChallenge` is what makes this the shelf's own challenge rather than a
 * document: "The snapshot reports it under that `mode` and `index`"
 * (`specs/instrumentation.md`), where `loadChallenge` "reports its `source` as
 * `"custom"`" and "Completing a challenge whose source is `"custom"` touches no
 * progress and no record". This point is about progress, so it opens the
 * challenge this way.
 */
async function startExtrasRun(index: number, machine: Solution): Promise<void> {
  await openChallenge(h, "extras", index);
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
 * Complete a shipped Extras challenge on `machine`, and answer the finished run.
 *
 * The completion itself is a posing step here rather than a verdict: every Extras
 * challenge "ships a reference solution under the requirement
 * `specs/modes/campaign.md` states for a course challenge"
 * (`specs/modes/extras.md`), which is one "whose run completes without faulting
 * within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start" — so a
 * build whose reference never completes leaves this point's world unposed, which
 * fails it.
 */
async function complete(
  index: number,
  machine: Solution,
): Promise<OrrerySnapshot> {
  await startExtrasRun(index, machine);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `Extras challenge ${index + 1} completes within CAMPAIGN_REFERENCE_CYCLES ` +
      `(${CAMPAIGN_REFERENCE_CYCLES}) cycles on the machine this point runs, ` +
      "which is the world it decides in",
  );
  return finished;
}

it("leaves the campaign's unlocked count, solved set and records where they stood", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    POSED_UNLOCKED,
    "the course holds more challenges than this world opens, so an unlock this " +
      "run has no business making would be visible in the count",
  );
  await h.debug.setUnlockedCount(POSED_UNLOCKED);
  await h.debug.setSolved("campaign", 0, true);
  await h.debug.setRecord("campaign", 0, "cost", 3);
  await h.debug.setRecord("campaign", 0, "cycles", 5);
  await h.debug.setRecord("campaign", 0, "area", 7);
  const stood = (await h.snapshot()).campaign;

  await complete(INDEX, await referenceSolution(h, "extras", INDEX));

  await openSelect(h, "campaign");
  await captureStill(h, "campaign-untouched");

  const after = await h.snapshot();
  assertEqual(
    after.extras.solved.includes(INDEX),
    true,
    "the run really was a completion, so the Extra it ran is marked solved in " +
      "its OWN mode",
  );
  assertNotNull(
    after.extras.records[INDEX] ?? null,
    "the run really was a completion, so the Extra it ran carries a record in " +
      "its OWN mode",
  );
  assertEqual(
    after.campaign.unlockedCount,
    stood.unlockedCount,
    "an Extra unlocks what ITS mode unlocks, and the Extras lock nothing, so " +
      "the campaign's unlocked count is where it stood",
  );
  assertDeepEqual(
    after.campaign.solved,
    stood.solved,
    "completing an Extra marks that Extra solved, so the campaign's solved set " +
      "is exactly the one that stood",
  );
  assertDeepEqual(
    after.campaign.records,
    stood.records,
    "completing an Extra updates that Extra's records, so every campaign " +
      "records entry, set or unset, is exactly the one that stood",
  );
});
