// progression/cell-loss-resets-pressure — a spent cell puts the pressure back to 0.
//
// THE SPEC LINE. `specs/progression.md` — "Cells" — gives the row exactly:
//
//   | Pressure | 0 |
//
// which is also the value `specs/channel.md` ("Pressure") says a level starts at:
// "it is `0` when a level starts".
//
// THE DRIVE is `progression/setback`'s shared staging: the pressure is raised to
// 50 through `setPressure`, a core is posed 20 units short of the intake, and the
// hall runs until it arrives. Each of the other rows that pose reads is a point of
// its own, so a build that zeroes the pressure and leaves a sightline running
// fails there and passes here.
//
// THE TOLERANCE is the case's standing pressure tolerance of +/- 0.05. A full
// second of the fastest rise this hall could produce would add 1.0, so the
// tolerance is a twentieth of that and a thousandth of the 50 the drive starts
// from: a build that never zeroed it cannot pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PRESSURE_MIN, PRESSURE_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the pressure back to 0 when a cell is spent", async () => {
  const { after } = await driveSetback(h);
  await captureStill(h, "pressure");

  assertNear(
    after.pressure,
    PRESSURE_MIN,
    PRESSURE_TOL,
    "the pressure after the cell was spent",
  );
});
