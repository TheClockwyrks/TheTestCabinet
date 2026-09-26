// campaign/records-are-per-challenge — a completion writes its own challenge's
// record and touches no other.
//
// THE RULE. "EACH CHALLENGE keeps its records: the lowest `cost`, the lowest
// `cycles`, and the lowest `area` over the session's completed runs OF IT"
// (`specs/modes/campaign.md`, Progression), and the snapshot holds them one apiece:
// `campaign.records` is "`[{ cost, cycles, area } | null]`", "one entry per
// challenge" (`specs/instrumentation.md`, Snapshot shape). A completion is a run
// "of it", so it reaches the entry belonging to the challenge that was run and no
// other — neither an entry already written nor an entry still `null`.
//
// THE WORLD CARRIES BOTH KINDS OF NEIGHBOUR. The course is put back to its opening
// state, where every record is `null`; the LAST challenge is then given a record of
// its own through "`setRecord(mode, index, metric, value)`"
// (`specs/instrumentation.md`), so the course holds one written entry, one entry
// about to be written, and a run of `null`s between them. Challenge 1 is completed
// on the build's own reference solution, and every entry but its own is compared
// against what it was.
//
// THE VERDICT. `campaign.records[0]` is filled; every other entry is exactly the
// value it held before the run, `null` entries included.

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

it("leaves every other challenge's record exactly as it was", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    2,
    "the course holds a challenge that is neither the one completed nor the one " +
      "given a record, so an untouched null entry is among the neighbours",
  );

  const other = count - 1;
  await h.debug.setRecord("campaign", other, "cost", 7);
  await h.debug.setRecord("campaign", other, "cycles", 11);
  await h.debug.setRecord("campaign", other, "area", 13);
  const before = (await h.snapshot()).campaign.records;
  assertNotNull(
    before[other] ?? null,
    "the last challenge holds a record of its own, which the completion below " +
      "must leave alone",
  );

  await complete(0, await referenceSolution(h, "campaign", 0));

  await openSelect(h, "campaign");
  await captureStill(h, "records");

  const after = (await h.snapshot()).campaign.records;
  assertEqual(
    after.length,
    before.length,
    "the course still reports one record entry per challenge",
  );
  assertNotNull(
    after[0] ?? null,
    "the completed challenge's own entry is the one the run wrote",
  );
  for (let index = 1; index < count; index += 1) {
    assertDeepEqual(
      after[index] ?? null,
      before[index] ?? null,
      `completing challenge 1 wrote only challenge 1's record, so challenge ` +
        `${index + 1}'s entry is exactly what it was`,
    );
  }
});
