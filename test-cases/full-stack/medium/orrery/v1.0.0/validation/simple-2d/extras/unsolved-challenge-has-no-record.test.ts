// extras/unsolved-challenge-has-no-record — a challenge never completed carries
// no record.
//
// THE RULE. A record is written by a COMPLETION and by nothing else: "if every
// set's tally has reached the challenge's `target`, the run completes: the status
// becomes `complete` and the metrics are recorded ... Completing a challenge
// marks it solved, unlocks what its mode unlocks, and updates the challenge's
// records" (`specs/simulation.md`, Completion and metrics), and the records a
// challenge keeps are "the lowest `cost`, the lowest `cycles`, and the lowest
// `area` OVER THE SESSION'S COMPLETED RUNS OF IT"
// (`specs/modes/campaign.md`, Progression, which `specs/modes/extras.md` adopts:
// "each challenge keeps its records as `specs/modes/campaign.md` states"). Over
// no completed runs there is no lowest, and the snapshot has a value for exactly
// that: `records: [{ cost, cycles, area } | NULL], // one entry per challenge`
// (`specs/instrumentation.md`, Snapshot shape). A fresh session has none of them:
// `reset` leaves "all progress cleared, so nothing is solved, EVERY RECORD and
// stash is empty".
//
// THE POINT IS READ IN BOTH HALVES OF ONE SESSION. First on the fresh shelf,
// where all ten entries are `null`; then after one Extra HAS been completed,
// where the nine that were not run are still `null`. The second half is what
// makes the reading about the challenges the session "has not completed" rather
// than about a build that simply never records: a build that wrote the completing
// run's metrics across the shelf passes the first half and fails the second.
//
// THE VERDICT. `extras.records` is ten entries long and every one of them is
// `null` on a fresh shelf; after Extras 1 completes, the other nine are still
// `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
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

it("reports no record for any Extra the session has not completed", async () => {
  await h.debug.reset();

  await openSelect(h, "extras");
  await captureStill(h, "no-records");

  const fresh = (await h.snapshot()).extras.records;
  assertLength(
    fresh,
    EXTRA_COUNT,
    "the records list carries one entry per challenge, and the Extras hold " +
      `EXTRA_COUNT (${EXTRA_COUNT}) of them`,
  );
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    assertNull(
      fresh[index] ?? null,
      `Extras ${index + 1} has never been completed in this session, so it ` +
        "carries no record at all",
    );
  }

  await complete(INDEX, await referenceSolution(h, "extras", INDEX));

  const after = (await h.snapshot()).extras.records;
  assertNotNull(
    after[INDEX] ?? null,
    "the run really was a completion, so the challenge it ran now carries a record",
  );
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    if (index === INDEX) continue;
    assertNull(
      after[index] ?? null,
      `Extras ${index + 1} was not the challenge that completed, so it still ` +
        "carries no record",
    );
  }
});
