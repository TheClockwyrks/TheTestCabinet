// progression/cell-loss-resets-chain — a spent cell takes the chain step back to 1.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by: "| Chain step | 1 |".
//
// THE POSE. The chain step is posed at 3 with `setChainStep`, which
// `specs/instrumentation.md` defines as setting the step and restarting "the
// window that returns the step to `1`", so the step holds for `CHAIN_RESET`
// (2.0 s, 120 ticks) of play from the call — twice the 55 ticks the ride takes.
// The step therefore stands at 3 when the cell is spent, and what puts it back to
// 1 is the spend rather than the window running out.
//
// WHY THE STEP IS POSED RATHER THAN EARNED. Driving the step up means driving a
// merge extraction, which is `extraction/chain-increment`'s requirement: a build
// with a correct setback and a broken merge would fail both points instead of
// one. The surface carries a single-field pose for the step precisely so a point
// about the setback can decide the setback alone.
//
// TOLERANCE. None: a chain step is a whole number and the case grades it exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveArrival } from "./setback";

/** A step well above the 1 a level opens at, so "back to 1" is readable. */
const RAISED_STEP = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the chain step back to 1 when a cell is spent", async () => {
  const setback = await driveArrival(h, { chainStep: RAISED_STEP });
  await captureStill(h, "chain");

  assertEqual(
    setback.posed.chainStep,
    RAISED_STEP,
    "the chain step the hall was posed at before the setback",
  );
  assertEqual(
    setback.spent.chainStep,
    1,
    "the chain step after the cell was spent",
  );
});
