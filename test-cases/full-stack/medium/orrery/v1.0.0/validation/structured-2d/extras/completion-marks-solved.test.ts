// extras/completion-marks-solved — finishing an Extra marks it solved.
//
// THE RULE. A completing boundary "marks the challenge solved"
// (`specs/simulation.md`, Completion and metrics; `specs/instrumentation.md`, the
// `completion` faculty), and "Completing a challenge marks it solved for the
// session" (`specs/modes/extras.md`, Progression). The snapshot carries the mark
// as `extras.solved`, "ascending indices" (`specs/instrumentation.md`, Snapshot
// shape), and the surface says the same of the set it poses: `setSolved` leaves
// it "ascending and free of duplicates".
//
// SO THE SET IS READ WHOLE, AND IN ORDER. The world is posed with a LATER Extra
// already marked, so the mark the completion adds has to be inserted BEFORE an
// existing entry rather than pushed onto the end. A build that appends the index
// it just solved reports `[5, 0]` here and fails; a build that keeps the set
// ascending reports `[0, 5]`. Reading the whole set also decides that the
// completion marked the challenge that was run.
//
// THE WORLD. The session is reset, Extras 6 is marked solved through the surface
// — "Neither operation touches progress" (`specs/instrumentation.md`) applies to
// the challenge operations, and `setSolved` is the operation that does touch it —
// and then Extras 1 is completed on the build's own reference machine.
//
// THE VERDICT. `extras.solved` is `[0, 5]`: the completed challenge's index is in
// it, the posed one is still in it, and the set is ascending.

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

/** Extras 6, the row marked before the run so the new mark has to be inserted. */
const POSED = 5;

it("adds the completed Extra to the mode's solved set, keeping it ascending", async () => {
  await h.debug.reset();
  await h.debug.setSolved("extras", POSED, true);
  assertDeepEqual(
    (await h.snapshot()).extras.solved,
    [POSED],
    "the world this point decides in has Extras 6 marked and Extras 1 not",
  );

  await complete(INDEX, await referenceSolution(h, "extras", INDEX));

  await openSelect(h, "extras");
  await captureStill(h, "solved-row");

  const solved = (await h.snapshot()).extras.solved;
  assertDeepEqual(
    solved,
    [INDEX, POSED],
    "completing Extras 1 adds its index to the mode's solved set, which stays " +
      "ascending and keeps the mark that was already there",
  );
  assertEqual(
    solved.every((index, at) => at === 0 || index > (solved[at - 1] ?? -1)),
    true,
    "the solved set is reported as ascending indices",
  );
});
