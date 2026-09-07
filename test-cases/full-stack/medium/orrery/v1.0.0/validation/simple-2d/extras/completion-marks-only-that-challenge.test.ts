// extras/completion-marks-only-that-challenge — completing one Extra marks one
// Extra.
//
// THE RULE. A completing boundary "marks THE CHALLENGE solved"
// (`specs/simulation.md`, Completion and metrics) — the challenge that ran, and
// no other. The Extras add nothing to that: "Completing a challenge marks it
// solved for the session" (`specs/modes/extras.md`, Progression), and unlike the
// campaign, where "Completing challenge `n` unlocks challenge `n + 1`", nothing
// on this shelf follows from a completion, because "Every challenge is unlocked
// from the start".
//
// THE WORLD IS A FRESH SHELF, so the solved set the run writes into is empty and
// every mark in it afterwards is one the run put there: `reset` leaves "all
// progress cleared, so nothing is solved" (`specs/instrumentation.md`), which is
// read back before the run. Extras 3 is the challenge run — a middle row, so a
// build that marked a neighbour, the first row, or the whole shelf is caught
// whichever way it slipped.
//
// THE VERDICT. `extras.solved` holds Extras 3's index and nothing else, and each
// of the other nine indices is read for its absence by name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
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

/** Extras 3, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 2;

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

it("marks the Extra that ran and leaves the other nine unsolved", async () => {
  await h.debug.reset();
  assertLength(
    (await h.snapshot()).extras.solved,
    0,
    "the shelf this run writes into is fresh, so every mark on it afterwards " +
      "is one the run made",
  );

  await complete(INDEX, await referenceSolution(h, "extras", INDEX));

  await openSelect(h, "extras");
  await captureStill(h, "one-solved");

  const solved = (await h.snapshot()).extras.solved;
  assertDeepEqual(
    solved,
    [INDEX],
    "completing Extras 3 marks Extras 3, so the mode's solved set holds that " +
      "index alone",
  );
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    if (index === INDEX) continue;
    assertEqual(
      solved.includes(index),
      false,
      `Extras ${index + 1} was not run, so completing Extras 3 leaves it unsolved`,
    );
  }
});
