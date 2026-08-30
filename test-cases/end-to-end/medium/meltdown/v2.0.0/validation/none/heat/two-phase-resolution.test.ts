// Meltdown — heat/two-phase-resolution: every flow resolves from the frame's
// opening heats.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A chain of four touching Arcs opening at 95, 5, 95 and 5 is advanced one
//   frame of 1/30 s, and each tower's observed delta is checked against the dH
//   validation/<engine>/thermal.ts computes for it from the frame's opening
//   heats, air, conduction and mass all included. The gradient and the frame
//   size are chosen so a sequential, in-place resolution diverges from the
//   two-phase answer by more than an order of magnitude beyond the tolerance,
//   and a balance-of-flows check would not: the air terms do not cancel, so
//   the middle's loss never equals its neighbours' gains in a conformant
//   build.

import { it } from "vitest";

it("Every flow resolves from the frame's opening heats", () => {
  throw new Error(
    "Meltdown: validation/heat/two-phase-resolution.test.ts is not implemented yet",
  );
});
