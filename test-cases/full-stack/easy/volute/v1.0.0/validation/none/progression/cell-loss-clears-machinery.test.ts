// progression/cell-loss-clears-machinery — a spent cell clears the active machinery.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by: "| Active machinery | cleared |".
//
// THE POSE. A `sightline` is granted before the arrival. `specs/machinery.md`
// gives it 12 s, far longer than the 55-tick ride, so it is still in force on the
// tick the cell is spent and a build that clears nothing reports it back. It is
// the one timed kind that leaves the feed speed alone
// (`specs/machinery.md` — "Sightline"), so the ride is the level's own and this
// point borrows nothing from `machinery/choke-multiplier`'s requirement or
// `machinery/backflow-direction`'s. Nothing else is moved off its opening value.
//
// TOLERANCE. None. The reading is `machinery` being reported as `null`, which
// `specs/instrumentation.md` fixes as the value "while no timed machinery is
// active".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveArrival } from "./setback";

/** The kind left running across the arrival, and the longest of the three. */
const RUNNING = "sightline";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the active machinery when a cell is spent", async () => {
  const setback = await driveArrival(h, { machinery: RUNNING });
  await captureStill(h, "machinery");

  assertEqual(
    setback.posed.machinery?.kind ?? null,
    RUNNING,
    "the machinery in force before the setback",
  );
  assertNull(
    setback.spent.machinery,
    "the machinery in force after the cell was spent",
  );
});
