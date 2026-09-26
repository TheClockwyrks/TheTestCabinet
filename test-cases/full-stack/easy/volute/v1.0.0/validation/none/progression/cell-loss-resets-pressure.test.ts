// progression/cell-loss-resets-pressure — a spent cell puts the pressure back to 0.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by: "| Pressure | 0 |".
//
// THE POSE. The pressure is raised to 50 before the arrival, which
// is inside the 0-to-100 range `specs/instrumentation.md` gives it, so a build
// that never zeroes it cannot pass by having started at 0. Nothing else is moved
// off its opening value: the other three rows of the same table are their own
// points.
//
// WHAT THE BLEED DOES TO THE READING, AND WHY IT DOES NOT MATTER. `specs/
// channel.md` bleeds the pressure at 2.0 per second while the channel carries at
// most 24 cores, so the one posed core bleeds about 1.2 off the 50 over the 37
// ticks of the ride. The reading before the arrival is taken at the call, before
// any tick has run, and asserted against 50; the reading after is asserted
// against 0. A build that only bled would report about 48.8.
//
// TOLERANCE. The case's standing pressure tolerance of +/- 0.05, which is a
// twentieth of what a full second of the fastest rise this hall could produce
// would add and a thousandth of the 50 the drive starts from.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PRESSURE_MIN, PRESSURE_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveArrival } from "./setback";

/** A pressure far from 0, and inside the 0-to-100 range the spec clamps to. */
const RAISED = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the pressure back to 0 when a cell is spent", async () => {
  const setback = await driveArrival(h, { pressure: RAISED });
  await captureStill(h, "pressure");

  assertNear(
    setback.posed.pressure,
    RAISED,
    PRESSURE_TOL,
    "the pressure the hall was raised to before the setback",
  );
  assertNear(
    setback.spent.pressure,
    PRESSURE_MIN,
    PRESSURE_TOL,
    "the pressure after the cell was spent",
  );
});
