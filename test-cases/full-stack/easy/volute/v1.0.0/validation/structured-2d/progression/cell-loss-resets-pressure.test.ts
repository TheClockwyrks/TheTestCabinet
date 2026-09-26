// progression/cell-loss-resets-pressure — a spent cell puts the pressure back to 0.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by:
//
//   | Pressure | 0 |
//
// One row, one point. `progression/setback.ts` carries the drive every row is
// read off and says why each figure is moved off its opening value first; this
// file reads the pressure and nothing else.
//
// THE TOLERANCE. The case's standing pressure tolerance of +/- 0.05, which is a
// twentieth of the 1.0 a full second of the fastest rise this hall could produce
// would add, and a thousandth of the 50 the drive starts from — so a build that
// never zeroed it cannot pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PRESSURE_MIN, PRESSURE_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { RAISED_PRESSURE, driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the pressure back to 0 when a cell is spent", async () => {
  const drive = await driveSetback(h);
  captureStill(h, "pressure");

  assertNear(
    drive.posed.pressure,
    RAISED_PRESSURE,
    PRESSURE_TOL,
    "the pressure the hall was raised to before the setback",
  );
  assertNear(
    drive.after.pressure,
    PRESSURE_MIN,
    PRESSURE_TOL,
    "the pressure after the cell was spent",
  );
});
