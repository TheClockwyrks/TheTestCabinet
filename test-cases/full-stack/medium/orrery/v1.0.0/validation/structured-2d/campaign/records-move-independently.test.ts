// campaign/records-move-independently — one completion moves the record it beat
// and leaves the other two alone.
//
// THE RULE. "Each challenge keeps its records: the lowest `cost`, the lowest
// `cycles`, and the lowest `area` over the session's completed runs of it, EACH
// METRIC INDEPENDENTLY" (`specs/modes/campaign.md`, Progression). Independently:
// the three are three separate lowest-so-far figures rather than the triple of the
// one best run, so a completion that beats one of them and loses on the other two
// writes the one it beat and nothing else.
//
// THE WORLD IS ONE RUN MEETING THREE RECORDS AT ONCE. Challenge 1 is completed once
// on the build's own reference solution, which is how the run's own three figures
// are learned. The records are then posed around that run — its cost one ABOVE what
// the run reaches, its cycles and its area one BELOW — through "`setRecord(mode,
// index, metric, value)` Sets one record of one challenge"
// (`specs/instrumentation.md`). The same machine is completed again, and because
// "A cycle's outcome, collisions included, is computed from the machine's parts,
// their tapes, and the sample fractions" (`specs/simulation.md`, Cycles and the
// clock) it reaches the same three figures: the
// cheapest cost yet, and more cycles and more area than the records standing.
//
// THE VERDICT. `cost` moved to the run's figure; `cycles` and `area` are still the
// smaller ones that were posed. A build that wrote the whole triple whenever any
// one metric improved fails on the other two.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
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

it("writes only the metric the run beat, leaving the other two records standing", async () => {
  await h.debug.reset();
  const machine = await referenceSolution(h, "campaign", 0);

  const first = await complete(0, machine);
  const ran = first.sim?.metrics ?? null;
  assertNotNull(
    ran,
    "a completed run reports its cost, cycles and area as sim.metrics",
  );
  const cost = ran?.cost ?? -1;
  const cycles = ran?.cycles ?? -1;
  const area = ran?.area ?? -1;
  assertGreaterThanOrEqual(
    cycles,
    1,
    "cycles is sim.cycle + 1 at the completing boundary, so a completed run ran " +
      "at least one cycle and a smaller whole number exists for the record",
  );
  assertGreaterThanOrEqual(
    area,
    1,
    "the area bank takes every hex of every placed part at the start of the run " +
      "and a completing machine holds a set, so a smaller whole number exists " +
      "for the record",
  );

  // One record above what the run reaches, two below: the completion that follows
  // beats exactly one of the three.
  await h.debug.setRecord("campaign", 0, "cost", cost + 1);
  await h.debug.setRecord("campaign", 0, "cycles", cycles - 1);
  await h.debug.setRecord("campaign", 0, "area", area - 1);

  const second = await complete(0, machine);

  await openSelect(h, "campaign");
  await captureStill(h, "records");

  assertEqual(
    second.sim?.metrics?.cost,
    cost,
    "the same machine costs the same, so the second completion is the run the " +
      "cost record was raised above",
  );
  assertEqual(
    second.sim?.metrics?.cycles,
    cycles,
    "and runs the same cycles, which is more than the cycles record standing",
  );
  assertEqual(
    second.sim?.metrics?.area,
    area,
    "and banks the same hexes, which is more than the area record standing",
  );

  const record = (await h.snapshot()).campaign.records[0] ?? null;
  assertNotNull(record, "the challenge still holds a record");
  assertEqual(
    record?.cost,
    cost,
    "the completion was the cheapest yet, so the cost record moves to it",
  );
  assertEqual(
    record?.cycles,
    cycles - 1,
    "each metric is kept independently, so the cycles record stays where it " +
      "stood rather than following the cost record's completion",
  );
  assertEqual(
    record?.area,
    area - 1,
    "and the area record stays where it stood for the same reason",
  );
});
