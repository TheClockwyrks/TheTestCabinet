// progression/cell-loss-resets-chain — a spent cell takes the chain step back to 1.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by:
//
//   | Chain step | 1 |
//
// One row, one point. `progression/setback.ts` carries the drive every row is
// read off; this file reads the chain step and nothing else.
//
// WHY THE STEP IS POSED RATHER THAN EARNED. `specs/instrumentation.md`
// (`setChainStep`) sets the step and restarts the window that returns it to `1`,
// so the raised step is standing when the cell is spent without an extraction
// being driven for it. What RAISES the step in play is
// `extraction/chain-increment`'s requirement, and what returns it after
// `CHAIN_RESET` is `extraction/chain-reset`'s: neither belongs in this point's
// failure modes, and the window the pose restarts is 2.0 s against a ride of
// under a second, so the step has not lapsed on its own by the time the cell
// goes.
//
// THE TOLERANCE. None: the chain step is a count and the case grades it exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { RAISED_CHAIN_STEP, driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the chain step back to 1 when a cell is spent", async () => {
  const drive = await driveSetback(h);
  captureStill(h, "chain");

  assertEqual(
    drive.posed.chainStep,
    RAISED_CHAIN_STEP,
    "the chain step the hall was posed at before the setback",
  );
  assertEqual(
    drive.after.chainStep,
    1,
    "the chain step after the cell was spent",
  );
});
