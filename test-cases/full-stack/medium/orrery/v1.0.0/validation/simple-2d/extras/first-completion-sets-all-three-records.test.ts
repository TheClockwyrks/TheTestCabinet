// extras/first-completion-sets-all-three-records — the first completion writes
// cost, cycles and area.
//
// THE RULE. "the run completes: the status becomes `complete` and THE METRICS ARE
// RECORDED", where the metrics are `cost`, "The machine's cost, as
// `specs/parts.md` computes it"; `cycles`, "`sim.cycle + 1` at the completing
// boundary: the number of cycles the machine ran"; and `area`, "The size of the
// area bank" (`specs/simulation.md`, Completion and metrics). What the challenge
// keeps of them is "the lowest `cost`, the lowest `cycles`, and the lowest
// `area` over the session's completed runs of it, EACH METRIC INDEPENDENTLY"
// (`specs/modes/campaign.md`, Progression, which `specs/modes/extras.md` adopts).
// Over exactly one completed run, the lowest of each is that run's own, so a
// first completion writes all three at their run's figures.
//
// THE RUN'S OWN FIGURES ARE THE ORACLE. `sim.metrics` is what "the run reported at
// the completing boundary" (`specs/instrumentation.md`, Snapshot shape:
// `metrics: { cost, cycles, area } | null`), and each record is read against it
// field by field rather than as a whole object, because no sentence of `specs/`
// forbids a build carrying something else beside the three.
//
// THE WORLD IS A FRESH SHELF. `reset` leaves "every record and stash empty"
// (`specs/instrumentation.md`), read back as a `null` entry before the run, so
// the three figures afterwards are three the completion wrote.
//
// THE VERDICT. `extras.records[0]` was `null`, and after the run its `cost`,
// `cycles` and `area` are each exactly the finished run's `sim.metrics`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
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

/** Extras 1, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 0;

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
    await advanceCycles(h, CYCLES_PER_STEP, CYCLES_PER_STEP);
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

it("records the first completing run's cost, cycles and area", async () => {
  await h.debug.reset();
  assertNull(
    (await h.snapshot()).extras.records[INDEX] ?? null,
    "the challenge carries no record before the run, so the three figures read " +
      "afterwards are three the completion wrote",
  );

  const finished = await complete(
    INDEX,
    await referenceSolution(h, "extras", INDEX),
  );

  await openSelect(h, "extras");
  await captureStill(h, "records-set");

  const metrics = finished.sim?.metrics ?? null;
  assertNotNull(
    metrics,
    "a completed run reports the three metrics it achieved as sim.metrics",
  );
  const record = (await h.snapshot()).extras.records[INDEX] ?? null;
  assertNotNull(
    record,
    "the first completion gives the challenge a record rather than leaving it null",
  );
  assertEqual(
    record?.cost,
    metrics?.cost,
    "over one completed run the lowest cost is that run's, so the cost record " +
      "is the figure the completing boundary reported",
  );
  assertEqual(
    record?.cycles,
    metrics?.cycles,
    "over one completed run the lowest cycles are that run's, so the cycles " +
      "record is the figure the completing boundary reported",
  );
  assertEqual(
    record?.area,
    metrics?.area,
    "over one completed run the lowest area is that run's, so the area record " +
      "is the figure the completing boundary reported",
  );
});
