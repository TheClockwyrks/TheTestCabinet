// runs/step-refuses-an-incomplete-machine — `step` applies the same readiness
// condition `play` does, and starts nothing without it.
//
// THE RULE. "The `play` action starts a run when every rise and every set is
// placed; otherwise it does nothing and the heading states which are missing.
// `step` under the same condition starts the run paused at its settle"
// (`specs/editor.md`, Running the machine). "Under the same condition" is the
// whole of this point: the condition `play` applies is the condition `step`
// applies, so a machine `play` refuses is a machine `step` refuses. What a
// refusal leaves is `sim` `null` — "The whole of a run, and `null` while editing"
// (`specs/state.md`).
//
// THE CONFIGURATION. `TWO_AND_TWO`, whose two reagents and two products give the
// challenge TWO rises and TWO sets, posed twice over so that BOTH halves of the
// conjunction are exercised by the one action:
//
//   1. Both rises and the set for product `0`, one set short.
//   2. Both sets and the rise for reagent `0`, one rise short.
//
// Each is loaded onto an emptied machine, so the second pose is not the first
// with something added, and nothing else is on the field either time.
//
// THE PRESS IS THE PLAYER'S. It goes through the key `specs/controls.md` binds to
// `step`, never through `startRun`, of which `specs/instrumentation.md` says "the
// readiness condition the `play` action applies is not applied".
//
// THE VERDICT. `sim` is `null` after each press, exactly as it was before it.
// This point decides the refusal alone; that `step` on a READY machine starts the
// run paused at its settle is its own review item.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { armPart, risePart, setPart, solution } from "../formats";
import { ORIGIN, TWO_AND_TWO } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  loadMachine,
  openChallengeDocument,
  stepAction,
  type Harness,
} from "../harness";

/** Both rises, the set for product `0`, and one arm: one SET short. */
const MISSING_A_SET = solution([
  risePart(0, -3, 0),
  risePart(1, -3, 3),
  setPart(0, 3, 0),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

/** Both sets, the rise for reagent `0`, and one arm: one RISE short. */
const MISSING_A_RISE = solution([
  risePart(0, -3, 0),
  setPart(0, 3, 0),
  setPart(1, 3, -3),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no run on a machine short of a set, or short of a rise", async () => {
  await openChallengeDocument(h, TWO_AND_TWO);

  await loadMachine(h, MISSING_A_SET);
  const editing = await h.snapshot();
  await stepAction(h);
  const afterSet = await h.snapshot();

  await clearWorld(h);
  await loadMachine(h, MISSING_A_RISE);
  await stepAction(h);
  await captureStill(h, "refused");
  const afterRise = await h.snapshot();

  assertNull(
    editing.sim,
    "no run is live before the presses, so a press is what would have started one",
  );
  assertNull(
    afterSet.sim,
    "step applies play's readiness condition, so one unplaced set starts no run",
  );
  assertEqual(
    afterSet.screen,
    "editor",
    "a refused step leaves the game where it was, in the editor over the same challenge",
  );
  assertNull(
    afterRise.sim,
    "step applies play's readiness condition, so one unplaced rise starts no run",
  );
  assertEqual(
    afterRise.screen,
    "editor",
    "a refused step leaves the game where it was, in the editor over the same challenge",
  );
});
