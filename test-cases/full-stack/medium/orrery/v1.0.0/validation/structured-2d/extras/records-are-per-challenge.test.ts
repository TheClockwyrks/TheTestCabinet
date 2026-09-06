// extras/records-are-per-challenge — a completion writes the records of the
// challenge that ran.
//
// THE RULE. "EACH CHALLENGE keeps its records: the lowest `cost`, the lowest
// `cycles`, and the lowest `area` over the session's COMPLETED RUNS OF IT"
// (`specs/modes/campaign.md`, Progression, which `specs/modes/extras.md` adopts:
// "each challenge keeps its records as `specs/modes/campaign.md` states"). Of it:
// a run of one challenge is not a completed run of any other, so it is no
// evidence about any other challenge's lowest anything. The snapshot keeps them
// apart the same way — `records: [{ cost, cycles, area } | null], // one entry
// per challenge` (`specs/instrumentation.md`, Snapshot shape).
//
// THE SHELF CARRIES BOTH KINDS OF NEIGHBOUR. Extras 6 is marked solved and given
// a record of its own through `setSolved` and `setRecord`, and the other eight
// are left with none, so the completion below is watched against a SET entry —
// the harder half, because an entry the run overwrote with its own metrics would
// read differently — and against eight unset ones at the same time.
//
// THE RUN IS EXTRAS 2, a row with neighbours on both sides, so a build that wrote
// its metrics one row out in either direction is caught.
//
// THE VERDICT. `extras.records[1]` is the finished run's own `sim.metrics`, and
// every other entry of `extras.records` is exactly the entry that stood before
// the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, EXTRA_COUNT, SPEEDS } from "../constants";
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

/** Extras 2, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 1;

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

/** Extras 6, the neighbour posed solved and carrying a record of its own. */
const POSED = 5;

it("writes the records of the Extra that ran and leaves every other entry alone", async () => {
  await h.debug.reset();
  await h.debug.setSolved("extras", POSED, true);
  await h.debug.setRecord("extras", POSED, "cost", 3);
  await h.debug.setRecord("extras", POSED, "cycles", 5);
  await h.debug.setRecord("extras", POSED, "area", 7);
  const stood = (await h.snapshot()).extras.records;
  assertNotNull(
    stood[POSED] ?? null,
    "the world this point decides in has one Extra carrying a record the run " +
      "must not disturb",
  );

  const finished = await complete(
    INDEX,
    await referenceSolution(h, "extras", INDEX),
  );

  await openSelect(h, "extras");
  await captureStill(h, "per-challenge");

  const metrics = finished.sim?.metrics ?? null;
  assertNotNull(
    metrics,
    "a completed run reports the three metrics it achieved as sim.metrics",
  );
  const after = (await h.snapshot()).extras.records;
  const record = after[INDEX] ?? null;
  assertNotNull(record, "the completed Extra carries a record of its own");
  assertEqual(
    record?.cost,
    metrics?.cost,
    "the run's cost is recorded against the challenge that ran",
  );
  assertEqual(
    record?.cycles,
    metrics?.cycles,
    "the run's cycles are recorded against the challenge that ran",
  );
  assertEqual(
    record?.area,
    metrics?.area,
    "the run's area is recorded against the challenge that ran",
  );
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    if (index === INDEX) continue;
    assertDeepEqual(
      after[index] ?? null,
      stood[index] ?? null,
      `Extras ${index + 1} had no completed run, so its records entry, set or ` +
        "unset, is exactly the one that stood",
    );
  }
});
