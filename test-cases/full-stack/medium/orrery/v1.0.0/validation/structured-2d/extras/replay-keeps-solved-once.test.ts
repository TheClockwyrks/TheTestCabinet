// extras/replay-keeps-solved-once — a replay leaves the solved set holding the
// challenge once.
//
// THE RULE. "Completing a challenge again is a REPLAY"
// (`specs/modes/campaign.md`, Progression, which `specs/modes/extras.md` adopts
// for the shelf), and what a completion writes is a mark in a SET: "adds that
// challenge to the mode's solved set". The snapshot fixes the shape of that
// field for both modes — `solved: [<number>], // ascending indices`
// (`specs/instrumentation.md`, Snapshot shape) — and ascending indices cannot
// hold the same index twice. The surface states the same invariant of the set it
// poses: `setSolved` leaves it "ascending and free of duplicates".
//
// THE WORLD CARRIES A SECOND MARK, so the reading is of a set with an order in it
// rather than of a single entry. Extras 5 is marked through the surface, Extras 1
// is completed on the build's own reference machine, and then Extras 1 is
// completed AGAIN, on the same machine, which is the replay.
//
// A BUILD THAT PUSHES rather than inserting reports `[0, 4, 0]` after the replay;
// one that re-sorts a list with a duplicate in it reports `[0, 0, 4]`; one that
// keeps a set reports `[0, 4]` both times.
//
// THE VERDICT. `extras.solved` is `[0, 4]` after the first completion and `[0, 4]`
// after the replay, and it is strictly ascending both times.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

/** Extras 5, marked through the surface so the set read below has an order in it. */
const POSED = 4;

/** Whether every index of `solved` is strictly greater than the one before it. */
function ascending(solved: readonly number[]): boolean {
  return solved.every(
    (index, at) => at === 0 || index > (solved[at - 1] ?? -1),
  );
}

it("holds the replayed Extra once, ascending and free of duplicates", async () => {
  await h.debug.reset();
  await h.debug.setSolved("extras", POSED, true);

  const machine = await referenceSolution(h, "extras", INDEX);
  await complete(INDEX, machine);
  const once = (await h.snapshot()).extras.solved;
  assertDeepEqual(
    once,
    [INDEX, POSED],
    "the first completion marks Extras 1 beside the posed mark, which is the " +
      "set the replay must leave alone",
  );

  await complete(INDEX, machine);

  await openSelect(h, "extras");
  await captureStill(h, "replayed");

  const twice = (await h.snapshot()).extras.solved;
  assertDeepEqual(
    twice,
    [INDEX, POSED],
    "completing an already-solved Extra is a replay, so the mode's solved set " +
      "still holds that challenge once and nothing else has moved",
  );
  assertEqual(
    ascending(twice),
    true,
    "the solved set is reported as ascending indices, which a set holding the " +
      "replayed challenge twice could not be",
  );
});
