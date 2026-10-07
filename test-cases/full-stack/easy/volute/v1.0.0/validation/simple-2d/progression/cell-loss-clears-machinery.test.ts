// progression/cell-loss-clears-machinery — a spent cell clears the timed
// machinery in force.
//
// THE SPEC LINE. `specs/progression.md` — "Cells" — gives the row exactly:
//
//   | Active machinery | cleared |
//
// which is also what a level start leaves: "A level begins with ... no active
// machinery".
//
// THE DRIVE is `progression/setback`'s shared staging. A `sightline` is granted
// before the ride — "become[s] the active machinery at [its] full duration" of
// 12 s (`specs/machinery.md`), which is longer than the drive, so it is still in
// force when the cell is spent and a build that clears nothing reports it back.
// Sightline is also the one timed kind that leaves the feed speed alone
// (`specs/machinery.md` — "Choke" multiplies it, "Backflow" reverses the train),
// so the ride to the intake runs at the level's own rate.
//
// TOLERANCE. None: the reading is whether anything is in force at all.

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
  const { posed, after } = await driveSetback(h);
  await captureStill(h, "machinery");

  assertEqual(
    posed.machinery?.kind ?? null,
    STANDING_MACHINERY,
    "the machinery in force before the cell was spent",
  );
  assertNull(
    after.machinery,
    "the machinery in force after the cell was spent",
  );
});
