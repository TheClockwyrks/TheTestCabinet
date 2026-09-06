// campaign/record-area-ignores-a-higher-run — a wider run leaves the area record
// where it stands.
//
// THE RULE. "Each challenge keeps its records: the lowest `cost`, the lowest
// `cycles`, and the lowest `area` over the session's completed runs of it, each
// metric independently" (`specs/modes/campaign.md`, Progression). THE LOWEST, which
// a record that merely tracked the latest run would fail: a completion that banked
// more hexes than the record standing changes nothing.
//
// HOW A RUN IS MADE THE WIDER ONE. The same machine banks the same hexes every time
// ("A cycle's outcome, collisions included, is computed from the machine's parts,
// their tapes, and the sample fractions", `specs/simulation.md`, Cycles and the
// clock), so the RECORD is lowered instead, one below
// what the run reaches, through "`setRecord(mode, index, metric, value)`", whose
// `value` is "a whole number of at least `0`" (`specs/instrumentation.md`). One
// below is always such a number: "A run whose machine holds no set never
// completes", the area bank "takes every hex of every placed part" at the start of
// the run, and a set's footprint is hexes, so a completed run banked at least one.
//
// THE VERDICT. `campaign.records[0].area` is still the smaller figure that was
// standing, not the wider run's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
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

it("leaves the area record at the smaller figure when a wider run completes the challenge", async () => {
  await h.debug.reset();
  const machine = await referenceSolution(h, "campaign", 0);

  const first = await complete(0, machine);
  const ran = first.sim?.metrics?.area ?? -1;
  assertGreaterThanOrEqual(
    ran,
    1,
    "a completing machine holds a set, and the area bank takes every hex of " +
      "every placed part at the start of the run, so a completed run banked at " +
      "least one hex and there is a smaller whole number for the record to stand at",
  );

  await h.debug.setRecord("campaign", 0, "area", ran - 1);
  assertEqual(
    (await h.snapshot()).campaign.records[0]?.area,
    ran - 1,
    "the standing record is one hex below what this machine's run banks, so " +
      "the completion that follows is the wider of the two",
  );

  const second = await complete(0, machine);

  await openSelect(h, "campaign");
  await captureStill(h, "kept");

  assertEqual(
    second.sim?.metrics?.area,
    ran,
    "the same machine banks the same hexes every time, so the second " +
      "completion is the run the record was lowered below",
  );
  assertEqual(
    (await h.snapshot()).campaign.records[0]?.area,
    ran - 1,
    "the challenge keeps the LOWEST area over the session's completed runs, so " +
      "the wider run leaves the record at the smaller figure",
  );
});
