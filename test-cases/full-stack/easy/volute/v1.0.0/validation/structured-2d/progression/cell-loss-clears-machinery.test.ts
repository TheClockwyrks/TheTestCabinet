// progression/cell-loss-clears-machinery — a spent cell clears the active machinery.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by:
//
//   | Active machinery | cleared |
//
// One row, one point. `progression/setback.ts` carries the drive every row is
// read off; this file reads the active machinery and nothing else. What a
// machinery DOES while it runs is `machinery/choke-multiplier` and its
// neighbours, and how long it runs is `machinery/machinery-expires`: the
// sightline the drive leaves standing is granted at its full 12 s, far longer
// than the ride to the intake, so a build whose machinery is still in force after
// the spend has failed this rule rather than run its timer out.
//
// THE TOLERANCE. None: a presence is exact under the standing tolerances.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { STANDING_MACHINERY, driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the active machinery when a cell is spent", async () => {
  const drive = await driveSetback(h);
  captureStill(h, "machinery");

  assertEqual(
    drive.posed.machinery?.kind ?? null,
    STANDING_MACHINERY,
    "the machinery in force before the setback",
  );
  assertNull(
    drive.after.machinery,
    "the machinery in force after the cell was spent",
  );
});
