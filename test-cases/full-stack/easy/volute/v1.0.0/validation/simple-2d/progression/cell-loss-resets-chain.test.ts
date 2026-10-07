// progression/cell-loss-resets-chain — a spent cell puts the chain step back to 1.
//
// THE SPEC LINE. `specs/progression.md` — "Cells" — gives the row exactly:
//
//   | Chain step | 1 |
//
// which is also what `specs/extraction.md` ("The chain step") says a level opens
// on: "The chain step `k` is an integer that is 1 when a level begins."
//
// THE DRIVE is `progression/setback`'s shared staging. The step is posed at 3
// through `setChainStep`, which `specs/instrumentation.md` says also "restarts
// the window that returns the step to `1`", so the posed step holds for
// `CHAIN_RESET` (2.0 s, 120 ticks) of play — well past the 36 ticks the ride to
// the intake takes. So a step of 1 after the spend is the spend's doing and not
// the window lapsing.
//
// TOLERANCE. None: the chain step is a whole number the case grades exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { RAISED_CHAIN, driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the chain step back to 1 when a cell is spent", async () => {
  const { posed, after } = await driveSetback(h);
  await captureStill(h, "chain");

  assertEqual(
    posed.chainStep,
    RAISED_CHAIN,
    "the chain step the hall stood at before the cell was spent",
  );
  assertEqual(after.chainStep, 1, "the chain step after the cell was spent");
});
