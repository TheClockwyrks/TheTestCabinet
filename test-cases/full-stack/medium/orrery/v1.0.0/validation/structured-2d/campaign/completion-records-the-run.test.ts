// campaign/completion-records-the-run — a challenge's first completion writes the
// run's three figures down.
//
// THE RULE. A completing boundary "records the metrics"
// (`specs/instrumentation.md`, the `completion` faculty), and the metrics are the
// three `specs/simulation.md` tabulates under Completion and metrics: `cost`, "The
// machine's cost, as `specs/parts.md` computes it"; `cycles`, "`sim.cycle + 1` at
// the completing boundary"; and `area`, "The size of the area bank". "Completing a
// challenge ... updates the challenge's records", and the records are "the lowest
// `cost`, the lowest `cycles`, and the lowest `area` over the session's completed
// runs of it" (`specs/modes/campaign.md`, Progression). A challenge with no earlier
// completion has one run to be lowest over, so its record IS that run.
//
// THE TWO READINGS ARE THE SAME MOMENT'S. The finished run reports its own figures
// as `sim.metrics`, "`{ cost, cycles, area } | null`"
// (`specs/instrumentation.md`, Snapshot shape), and the challenge reports its
// record as `campaign.records[index]` in the same shape. Comparing the record to
// the run's own metrics rather than to figures written down here is what keeps this
// a point about RECORDING: what each metric is worth is the metrics' own item, and
// a build that computes them differently is measured on the same figures twice.
//
// THE WORLD. The course is put back to its opening state, where "every record and
// stash is empty" (`specs/instrumentation.md`, `reset`), and challenge 1 is
// completed once on the build's own reference solution.
//
// THE VERDICT. `campaign.records[0]` is no longer `null`, and its `cost`, `cycles`
// and `area` are the finished run's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

it("gives a challenge with no record one holding the finished run's cost, cycles and area", async () => {
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).campaign.records[0],
    null,
    "challenge 1 has no record before this run, so the record it gains is the " +
      "record of a FIRST completion",
  );

  const finished = await complete(0, await referenceSolution(h, "campaign", 0));

  await openSelect(h, "campaign");
  await captureStill(h, "recorded");

  const ran = finished.sim?.metrics ?? null;
  assertNotNull(
    ran,
    "a completed run reports the metrics it was recorded on as sim.metrics",
  );
  const record = (await h.snapshot()).campaign.records[0] ?? null;
  assertNotNull(
    record,
    "completing a challenge that had no record gives it one",
  );
  assertEqual(
    record?.cost,
    ran?.cost,
    "the recorded cost is the finished run's cost",
  );
  assertEqual(
    record?.cycles,
    ran?.cycles,
    "the recorded cycles are the finished run's cycles",
  );
  assertEqual(
    record?.area,
    ran?.area,
    "the recorded area is the finished run's area",
  );
});
